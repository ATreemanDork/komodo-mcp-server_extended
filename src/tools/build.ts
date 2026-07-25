/**
 * Build Tools
 *
 * Tools for managing Komodo Build resources.
 *
 * Tools (6):
 * - `komodo_build_list`   — list registered builds
 * - `komodo_build_info`   — full build resource (config + status)
 * - `komodo_build_action` — lifecycle: run (long-running, polled) | cancel (fire-and-forget)
 * - `komodo_build_logs`   — fetch logs from a previous build run via update id
 * - `komodo_build_apply`  — create-or-update (discriminated by `action`)
 * - `komodo_build_delete` — unregister a build
 *
 * Ported from the reference repo
 * (references/komodo-mcp-server/src/tools/build.ts) onto this repo's own
 * `@modelcontextprotocol/sdk` integration — see the dispatch contract's
 * mechanical conversion rules (Zod import, `structured`→`structuredResult`,
 * dropped cancellation/progress-reporting plumbing, explicit `String()`
 * coercion for numeric template interpolation) for the shape of the
 * changes relative to the reference.
 *
 * @module tools/build
 */

import { z } from "zod";
import { Types } from "komodo_client";
import { defineTool } from "../mcp/define-tool.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { ToolCategories, ToolScopes, config } from "../config/index.js";
import { AppErrorFactory } from "../errors/index.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { paginate } from "../utils/pagination.js";
import { wrapExecuteAndPoll, buildActionResult, extractUpdateId } from "../utils/polling.js";
import { buildApplyResult, buildDeleteResult } from "../utils/response-formatter.js";
import { tryRegisterResource } from "../utils/resource-link.js";
import { redactObject } from "../utils/redact.js";
import { renderBuildList, renderBuildInfo, renderBuildLogs } from "./renderers/build.js";
import { renderActionResult } from "./renderers/_shared.js";
import {
  buildIdSchema,
  buildListOutputSchema,
  buildInfoOutputSchema,
  buildActionOutputSchema,
  buildActionInputSchema,
  buildApplyInputSchema,
  buildLogsOutputSchema,
} from "./schemas/build.js";
import {
  applyResultSchema,
  deleteResultSchema,
  inlineFullInputSchema,
  paginationInputSchema,
} from "./schemas/shared.js";

type BuildListItem = Types.BuildListItem;
type Update = Types.Update;

function formatVersion(v?: { major: number; minor: number; patch: number }): string | undefined {
  if (!v) return undefined;
  if (v.major === 0 && v.minor === 0 && v.patch === 0) return undefined;
  return `${String(v.major)}.${String(v.minor)}.${String(v.patch)}`;
}

// ============================================================================
// List
// ============================================================================

export const listBuildsTool = defineTool({
  name: "komodo_build_list",
  description:
    "List all builds registered in Komodo. Shows build id, name, current state (Building/Ok/Failed/Unknown), version, attached builder, source repo and branch.",
  input: paginationInputSchema,
  output: buildListOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.BUILD },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const builds = await wrapApiCall("listBuilds", () => komodo.client.read("ListBuilds", {}));

    const allItems = builds.map((b: BuildListItem) => {
      const version = formatVersion(b.info.version);
      return {
        id: b.id,
        name: b.name,
        state: b.info.state,
        ...(version ? { version } : {}),
        ...(b.info.builder_id ? { builder_id: b.info.builder_id } : {}),
        ...(b.info.repo ? { repo: b.info.repo } : {}),
        ...(b.info.branch ? { branch: b.info.branch } : {}),
        ...(b.info.last_built_at ? { last_built_at: b.info.last_built_at } : {}),
      };
    });

    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderBuildList(payload) });
  },
});

registerToolDefinition(listBuildsTool);

// ============================================================================
// Info
// ============================================================================

export const getBuildInfoTool = defineTool({
  name: "komodo_build_info",
  description:
    "Get the full Komodo Build resource for a single build, including its configuration (builder, repo/branch, image, dockerfile, build args, labels) and last-built metadata.",
  input: z
    .object({
      build: buildIdSchema.describe("Build id or name"),
    })
    .merge(inlineFullInputSchema),
  output: buildInfoOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.BUILD },
  requiredScopes: [ToolScopes.READ],
  handler: async (args, { sessionId }) => {
    const komodo = requireClient();
    const result = redactObject(
      await wrapApiCall("getBuild", () => komodo.client.read("GetBuild", { build: args.build })),
    );
    const link = tryRegisterResource({
      ctx: { sessionId },
      category: "info",
      name: `${result.name} (build info)`,
      mimeType: "application/json",
      content: JSON.stringify(result, null, 2),
      ttlMs: config.KOMODO_RESOURCE_TTL_INFO,
      inlineFull: args.inline_full,
      description: `Full build resource for ${result.name}`,
    });
    const version = formatVersion(result.config?.version);
    const summary = {
      id: result._id?.$oid ?? args.build,
      name: result.name,
      ...(version ? { version } : {}),
      ...(result.config?.builder_id ? { builder_id: result.config.builder_id } : {}),
      ...(result.config?.repo ? { repo: result.config.repo } : {}),
      ...(result.config?.branch ? { branch: result.config.branch } : {}),
      ...(result.info?.last_built_at ? { last_built_at: result.info.last_built_at } : {}),
    };
    const payload = link ? { summary, resourceLink: link } : { summary, info: result };
    return structuredResult(payload, {
      text: renderBuildInfo(payload),
      ...(link ? { links: [link] } : {}),
    });
  },
});

registerToolDefinition(getBuildInfoTool);

// ============================================================================
// Action (run / cancel)
// ============================================================================

/** Maps the action enum to the corresponding Komodo execute API name. */
const BUILD_ACTION_API_MAP = {
  run: "RunBuild",
  cancel: "CancelBuild",
} as const satisfies Record<z.infer<typeof buildActionInputSchema>["action"], "RunBuild" | "CancelBuild">;

export const buildActionTool = defineTool({
  name: "komodo_build_action",
  description:
    "Run a lifecycle action on a Komodo Build. action=run: trigger build (long-running; polled to completion). action=cancel: abort in-progress build (fire-and-forget). Returns the resulting Update.",
  input: buildActionInputSchema,
  output: buildActionOutputSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.BUILD },
  requiredScopes: [ToolScopes.OPERATE],
  handler: async (args) => {
    const komodo = requireClient();
    const apiAction = BUILD_ACTION_API_MAP[args.action];
    if (args.action === "run") {
      const update = await wrapExecuteAndPoll(`run build '${args.build}'`, () =>
        komodo.client.execute(apiAction as "RunBuild", { build: args.build }),
      );
      const payload = buildActionResult(update, "run", "build", args.build);
      return structuredResult(payload, {
        text: renderActionResult(payload, { updateId: extractUpdateId(update), logs: update.logs }),
      });
    }
    const update: Update = await wrapApiCall(
      `cancel build '${args.build}'`,
      // @sdk-constraint — SDK execute() type uses literal-keyed unions; runtime accepts mapped string
      () => komodo.client.execute(apiAction as "CancelBuild", { build: args.build }),
    );
    const payload = buildActionResult(update, "cancel", "build", args.build);
    return structuredResult(payload, {
      text: renderActionResult(payload, { updateId: extractUpdateId(update), logs: update.logs }),
    });
  },
});

registerToolDefinition(buildActionTool);

// ============================================================================
// Logs
// ============================================================================

export const getBuildLogsTool = defineTool({
  name: "komodo_build_logs",
  description:
    "Fetch per-stage logs from a previous build run. Pass the `update_id` returned by `komodo_build_action`.",
  input: z
    .object({
      update_id: z.string().min(1).describe("Komodo Update id returned by a previous komodo_build_run call"),
    })
    .merge(inlineFullInputSchema),
  output: buildLogsOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.BUILD },
  requiredScopes: [ToolScopes.READ],
  handler: async (args, { sessionId }) => {
    const komodo = requireClient();
    const update: Update = await wrapApiCall("getBuildUpdate", () =>
      komodo.client.read("GetUpdate", { id: args.update_id }),
    );

    const buildName = update.target.id || args.update_id;

    const fullLogs =
      update.logs.length > 0
        ? update.logs
            .map((l) => {
              const head = `=== ${l.stage} ${l.success ? "✅" : "❌"} ===`;
              const cmd = l.command ? `$ ${l.command}` : "";
              const out = l.stdout ? `[stdout]\n${l.stdout}` : "";
              const err = l.stderr ? `[stderr]\n${l.stderr}` : "";
              return [head, cmd, out, err].filter(Boolean).join("\n");
            })
            .join("\n\n")
        : "";

    const link = fullLogs
      ? tryRegisterResource({
          ctx: { sessionId },
          category: "logs",
          name: `${buildName} (build logs)`,
          mimeType: "text/plain",
          content: fullLogs,
          ttlMs: config.KOMODO_RESOURCE_TTL_LOGS,
          inlineFull: args.inline_full,
          description: `Build logs for update ${args.update_id}`,
        })
      : null;

    const summary = {
      id: args.update_id,
      name: buildName,
    };
    const payload = link
      ? {
          summary,
          update_id: args.update_id,
          success: update.success,
          status: update.status,
          resourceLink: link,
        }
      : {
          summary,
          update_id: args.update_id,
          success: update.success,
          status: update.status,
          logs: update.logs.map((l) => ({
            stage: l.stage,
            command: l.command,
            success: l.success,
            stdout: l.stdout,
            stderr: l.stderr,
            start_ts: l.start_ts,
            end_ts: l.end_ts,
          })),
        };

    return structuredResult(payload, {
      text: renderBuildLogs(payload),
      ...(link ? { links: [link] } : {}),
    });
  },
});

registerToolDefinition(getBuildLogsTool);

// ============================================================================
// Apply / Delete
// ============================================================================

export const applyBuildTool = defineTool({
  name: "komodo_build_apply",
  description: [
    "Create or update a Komodo Build (PATCH-style). Does not trigger a build — call `komodo_build_action` run afterwards.",
    'action="create": new build. Required: name. Provide repo/branch/builder in config.',
    'action="update": existing build (`build` required). Only fields in `config` change.',
  ].join("\n"),
  input: buildApplyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.BUILD },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "create") {
      if (!args.name) throw AppErrorFactory.validation.fieldRequired("name");
      const name = args.name;
      const result = await wrapApiCall(
        "createBuild",
        // @type-variance — Zod-inferred optional fields (`T | undefined`) → SDK `Partial<BuildConfig>` (`T`).
        () =>
          komodo.client.write("CreateBuild", {
            name,
            config: (args.config ?? {}) as Types._PartialBuildConfig,
          }),
      );
      const built = buildApplyResult("create", "build", name, result);
      return structuredResult(built.payload, { text: built.text });
    }
    if (!args.build) throw AppErrorFactory.validation.fieldRequired("build");
    const buildId = args.build;
    const result = await wrapApiCall(
      "updateBuild",
      // @type-variance — Zod-inferred optional fields (`T | undefined`) → SDK `Partial<BuildConfig>` (`T`).
      () =>
        komodo.client.write("UpdateBuild", {
          id: buildId,
          config: args.config as Types._PartialBuildConfig,
        }),
    );
    const built = buildApplyResult("update", "build", buildId, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(applyBuildTool);

export const deleteBuildTool = defineTool({
  name: "komodo_build_delete",
  description: "Unregister a Build from Komodo. Does not delete previously pushed images from the registry.",
  input: z.object({
    build: buildIdSchema.describe("Build id or name to delete"),
  }),
  output: deleteResultSchema,
  annotations: { destructiveHint: true },
  guardrail: "destructive",
  _meta: { category: ToolCategories.BUILD },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("deleteBuild", () => komodo.client.write("DeleteBuild", { id: args.build }));
    const built = buildDeleteResult("build", args.build, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(deleteBuildTool);
