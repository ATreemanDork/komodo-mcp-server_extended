/**
 * Builder Tools
 *
 * Tools for managing Komodo Builder resources — the compute target Komodo
 * uses to actually run a Docker build (referenced by `builder_id` from Build
 * resources, the existing `komodo_build_*` tools). Closes a real gap: prior
 * live testing found `komodo_build_action(run)` fails with "Must attach
 * builder to RunBuild" because no Builder resource type existed yet.
 *
 * Tools (6):
 * - `komodo_builder_list`   — list registered builders
 * - `komodo_builder_info`   — full builder resource (offloaded via ResourceLink when large)
 * - `komodo_builder_apply`  — create-or-update (discriminated by `action`)
 * - `komodo_builder_copy`   — create a new builder copying an existing one's config
 * - `komodo_builder_rename` — rename an existing builder
 * - `komodo_builder_delete` — unregister a builder
 *
 * No reference-repo file to port from (`references/komodo-mcp-server` never
 * built this category) — genuinely new construction, grounded directly in
 * `komodo_client`'s `dist/types.d.ts`/`responses.d.ts`, not guessed. CRUD
 * shape modeled on `tools/alerter.ts`; config discriminated union modeled on
 * `tools/schemas/deployment.ts`'s `DeploymentImageSchema`.
 *
 * `RenameBuilder` note: unlike `CreateBuilder`/`CopyBuilder`/`UpdateBuilder`/
 * `DeleteBuilder` (all of which return `Types.Builder` directly from
 * `komodo.client.write(...)`), `RenameBuilder`'s response type is
 * `Types.Update` (per `responses.d.ts`) even though it is still dispatched
 * through `.write()`, not `.execute()` (confirmed by its placement in the
 * `WriteRequest` union in `types.d.ts`, alongside every other `Rename*`
 * request in this codebase — e.g. `RenameRepo`, `RenameAction`). So it's an
 * async operation like a lifecycle action, just issued over `.write()`
 * instead of `.execute()`. `wrapExecuteAndPoll` only depends on its
 * callback returning `Promise<Update>`, so it accepts a `.write()` call
 * here just as readily as the `.execute()` calls used elsewhere (e.g.
 * `tools/container.ts`'s `containerActionTool`).
 *
 * @module tools/builder
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
import { buildApplyResult, buildDeleteResult } from "../utils/response-formatter.js";
import { wrapExecuteAndPoll, buildActionResult, extractUpdateId } from "../utils/polling.js";
import { tryRegisterResource } from "../utils/resource-link.js";
import { redactObject } from "../utils/redact.js";
import { renderActionResult } from "./renderers/_shared.js";
import { renderBuilderList, renderBuilderInfo } from "./renderers/builder.js";
import {
  builderIdSchema,
  builderListOutputSchema,
  builderInfoOutputSchema,
  builderApplyInputSchema,
  builderCopyInputSchema,
  builderRenameInputSchema,
} from "./schemas/builder.js";
import {
  actionResultSchema,
  applyResultSchema,
  deleteResultSchema,
  inlineFullInputSchema,
  paginationInputSchema,
} from "./schemas/shared.js";

type BuilderListItem = Types.BuilderListItem;

// ============================================================================
// List
// ============================================================================

export const listBuildersTool = defineTool({
  name: "komodo_builder_list",
  description:
    "List all builders registered in Komodo. Builders are compute targets Komodo uses to run Docker builds (Url/Periphery address, connected Server, or on-demand Aws EC2 instance).",
  input: paginationInputSchema,
  output: builderListOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.BUILDER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const builders = await wrapApiCall("listBuilders", () => komodo.client.read("ListBuilders", {}));

    const allItems = builders.map((b: BuilderListItem) => ({
      id: b.id,
      name: b.name,
      builder_type: b.info.builder_type,
      ...(b.info.instance_type ? { instance_type: b.info.instance_type } : {}),
    }));

    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderBuilderList(payload) });
  },
});

registerToolDefinition(listBuildersTool);

// ============================================================================
// Info
// ============================================================================

export const getBuilderInfoTool = defineTool({
  name: "komodo_builder_info",
  description:
    "Get the full Komodo Builder resource (type, connection/instance configuration). Offloaded via a session-scoped resource link when available.",
  input: z
    .object({
      builder: builderIdSchema.describe("Builder id or name"),
    })
    .merge(inlineFullInputSchema),
  output: builderInfoOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.BUILDER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args, { sessionId }) => {
    const komodo = requireClient();
    const result = redactObject(
      await wrapApiCall("getBuilder", () => komodo.client.read("GetBuilder", { builder: args.builder })),
    );
    const link = tryRegisterResource({
      ctx: { sessionId },
      category: "info",
      name: `${result.name} (builder info)`,
      mimeType: "application/json",
      content: JSON.stringify(result, null, 2),
      ttlMs: config.KOMODO_RESOURCE_TTL_INFO,
      inlineFull: args.inline_full,
      description: `Full builder resource for ${result.name}`,
    });
    const summary = {
      id: result._id?.$oid ?? args.builder,
      name: result.name,
      ...(result.config?.type ? { builder_type: result.config.type } : {}),
    };
    const payload = link ? { summary, resourceLink: link } : { summary, info: result };
    return structuredResult(payload, {
      text: renderBuilderInfo(payload),
      ...(link ? { links: [link] } : {}),
    });
  },
});

registerToolDefinition(getBuilderInfoTool);

// ============================================================================
// CRUD
// ============================================================================

export const applyBuilderTool = defineTool({
  name: "komodo_builder_apply",
  description: [
    "Create or update a Komodo Builder (PATCH-style). Builders are the compute target used to run Docker builds — attach a builder to a Build's `builder_id` before running it.",
    'action="create": new builder. Required: name. Provide `config` with discriminated `type` ("Url", "Server", or "Aws") and matching `params`.',
    'action="update": existing builder (`builder` required). Only fields in `config` change.',
  ].join("\n"),
  input: builderApplyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.BUILDER },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "create") {
      if (!args.name) throw AppErrorFactory.validation.fieldRequired("name");
      const name = args.name;
      const result = await wrapApiCall(
        "createBuilder",
        // @type-variance — Zod-inferred optional fields → SDK `PartialBuilderConfig` (discriminated `type`/`params` union).
        () =>
          komodo.client.write("CreateBuilder", {
            name,
            config: (args.config ?? {}) as unknown as Types.PartialBuilderConfig,
          }),
      );
      const built = buildApplyResult("create", "builder", name, result);
      return structuredResult(built.payload, { text: built.text });
    }
    if (!args.builder) throw AppErrorFactory.validation.fieldRequired("builder");
    if (!args.config) throw AppErrorFactory.validation.fieldRequired("config");
    const builderId = args.builder;
    const result = await wrapApiCall(
      "updateBuilder",
      // @type-variance — Zod-inferred optional fields → SDK `PartialBuilderConfig` (discriminated `type`/`params` union).
      () =>
        komodo.client.write("UpdateBuilder", {
          id: builderId,
          config: args.config as unknown as Types.PartialBuilderConfig,
        }),
    );
    const built = buildApplyResult("update", "builder", builderId, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(applyBuilderTool);

export const copyBuilderTool = defineTool({
  name: "komodo_builder_copy",
  description: "Create a new Komodo Builder named `name`, copying the configuration of the builder at `id`.",
  input: builderCopyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.BUILDER },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("copyBuilder", () =>
      komodo.client.write("CopyBuilder", { name: args.name, id: args.id }),
    );
    const built = buildApplyResult("create", "builder", args.name, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(copyBuilderTool);

export const renameBuilderTool = defineTool({
  name: "komodo_builder_rename",
  description: "Rename a Komodo Builder.",
  input: builderRenameInputSchema,
  output: actionResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.BUILDER },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const update = await wrapExecuteAndPoll("renameBuilder", () => {
      const komodo = requireClient();
      // `RenameBuilder` is dispatched via `.write()` (it's in the SDK's `WriteRequest`
      // union, not `ExecuteRequest`) but — unlike the other Builder writes — its
      // response type is `Types.Update`, an async operation like a lifecycle action.
      // See the module-level doc comment for the full write-vs-execute reasoning.
      return komodo.client.write("RenameBuilder", { id: args.builder, name: args.name });
    });
    const payload = buildActionResult(update, "rename", "builder", args.builder);
    return structuredResult(payload, {
      text: renderActionResult(payload, { updateId: extractUpdateId(update), logs: update.logs }),
    });
  },
});

registerToolDefinition(renameBuilderTool);

export const deleteBuilderTool = defineTool({
  name: "komodo_builder_delete",
  description: "Unregister a Builder from Komodo. Builds that reference this builder's id will fail until re-attached.",
  input: z.object({
    builder: builderIdSchema.describe("Builder id or name to delete"),
  }),
  output: deleteResultSchema,
  annotations: { destructiveHint: true },
  guardrail: "destructive",
  _meta: { category: ToolCategories.BUILDER },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("deleteBuilder", () => komodo.client.write("DeleteBuilder", { id: args.builder }));
    const built = buildDeleteResult("builder", args.builder, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(deleteBuilderTool);
