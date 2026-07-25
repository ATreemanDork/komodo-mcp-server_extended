/**
 * ResourceSync Tools
 *
 * Tools for managing Komodo ResourceSync (GitOps reconciliation of TOML resource files).
 *
 * Tools (5):
 * - `komodo_resource_sync_list`   — list registered resource syncs
 * - `komodo_resource_sync_info`   — full resource sync resource
 * - `komodo_resource_sync_action` — lifecycle: run | refresh
 * - `komodo_resource_sync_apply`  — create-or-update (discriminated by `action`)
 * - `komodo_resource_sync_delete` — unregister a resource sync
 *
 * Ported from the reference repo
 * (references/komodo-mcp-server/src/tools/resource-sync.ts) onto this
 * repo's own `@modelcontextprotocol/sdk` integration — see the dispatch
 * contract's mechanical conversion rules (Zod import,
 * `structured`→`structuredResult`, dropped cancellation/progress-reporting
 * plumbing) for the shape of the changes relative to the reference.
 *
 * DEVIATION: the reference's `refresh` branch of `komodo_resource_sync_action`
 * bypasses `structured()` entirely and returns a bare text block (no
 * `structuredContent`) — safe there because the reference framework never
 * enforced output schemas. This port registers `output` on every tool,
 * so a live check surfaced `refresh` failing SDK-level
 * output validation. Fixed to return `structuredResult()` like every other
 * action tool, matching `actionResultSchema`, instead of following the
 * reference's inconsistency.
 *
 * @module tools/resource-sync
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
import { buildApplyResult, buildDeleteResult, formatActionResponse } from "../utils/response-formatter.js";
import { tryRegisterResource } from "../utils/resource-link.js";
import { redactObject, redactTomlSecrets } from "../utils/redact.js";
import { renderResourceSyncList, renderResourceSyncInfo } from "./renderers/resource-sync.js";
import { renderActionResult } from "./renderers/_shared.js";
import {
  resourceSyncIdSchema,
  resourceSyncListOutputSchema,
  resourceSyncInfoOutputSchema,
  resourceSyncActionOutputSchema,
  resourceSyncActionInputSchema,
  resourceSyncApplyInputSchema,
} from "./schemas/resource-sync.js";
import {
  applyResultSchema,
  deleteResultSchema,
  inlineFullInputSchema,
  paginationInputSchema,
} from "./schemas/shared.js";

type ResourceSyncListItem = Types.ResourceSyncListItem;

/**
 * Redact a ResourceSync for output. `redactObject` handles key-name-signalled
 * fields (e.g. `config.webhook_secret`). The pending-diff and remote-file TOML
 * strings carry secret `[[variable]]` values inline — not a redactable object
 * field — so mask each with `redactTomlSecrets`. Komodo Core only redacts
 * these for non-admin callers, which this admin-scoped server is not (#160).
 */
function redactResourceSync(sync: Types.ResourceSync): Types.ResourceSync {
  const redacted = redactObject(sync);
  const info = redacted.info;
  if (info) {
    const maskDiff = (d: Types.DiffData): void => {
      const data = d.data as { proposed?: string; current?: string };
      if (typeof data.proposed === "string") data.proposed = redactTomlSecrets(data.proposed);
      if (typeof data.current === "string") data.current = redactTomlSecrets(data.current);
    };
    info.resource_updates?.forEach((r) => {
      maskDiff(r.data);
    });
    info.variable_updates?.forEach(maskDiff);
    info.user_group_updates?.forEach(maskDiff);
    info.remote_contents?.forEach((f) => {
      f.contents = redactTomlSecrets(f.contents);
    });
    info.remote_errors?.forEach((f) => {
      f.contents = redactTomlSecrets(f.contents);
    });
  }
  return redacted;
}

// ============================================================================
// List
// ============================================================================

export const listResourceSyncsTool = defineTool({
  name: "komodo_resource_sync_list",
  description:
    "List all resource syncs registered in Komodo. Shows configured repo+branch, managed mode, and last successful sync timestamp/hash.",
  input: paginationInputSchema,
  output: resourceSyncListOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.RESOURCE_SYNC },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const syncs = await wrapApiCall("listResourceSyncs", () => komodo.client.read("ListResourceSyncs", {}));

    const allItems = syncs.map((s: ResourceSyncListItem) => ({
      id: s.id,
      name: s.name,
      state: s.info.state,
      managed: s.info.managed,
      ...(s.info.repo ? { repo: s.info.repo } : {}),
      ...(s.info.branch ? { branch: s.info.branch } : {}),
      ...(Array.isArray(s.info.resource_path) && s.info.resource_path.length > 0
        ? { resource_path: s.info.resource_path }
        : {}),
      ...(s.info.last_sync_ts ? { last_sync_ts: s.info.last_sync_ts } : {}),
      ...(s.info.last_sync_hash ? { last_sync_hash: s.info.last_sync_hash } : {}),
    }));

    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderResourceSyncList(payload) });
  },
});

registerToolDefinition(listResourceSyncsTool);

// ============================================================================
// Info
// ============================================================================

export const getResourceSyncInfoTool = defineTool({
  name: "komodo_resource_sync_info",
  description: "Get the full Komodo ResourceSync resource including pending diffs.",
  input: z
    .object({
      resource_sync: resourceSyncIdSchema.describe("ResourceSync id or name"),
    })
    .merge(inlineFullInputSchema),
  output: resourceSyncInfoOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.RESOURCE_SYNC },
  requiredScopes: [ToolScopes.READ],
  handler: async (args, { sessionId }) => {
    const komodo = requireClient();
    const result = redactResourceSync(
      await wrapApiCall("getResourceSync", () => komodo.client.read("GetResourceSync", { sync: args.resource_sync })),
    );
    const link = tryRegisterResource({
      ctx: { sessionId },
      category: "info",
      name: `${result.name} (resource sync info)`,
      mimeType: "application/json",
      content: JSON.stringify(result, null, 2),
      ttlMs: config.KOMODO_RESOURCE_TTL_INFO,
      inlineFull: args.inline_full,
      description: `Full resource sync payload for ${result.name}`,
    });
    const summary = {
      id: result._id?.$oid ?? args.resource_sync,
      name: result.name,
    };
    const payload = link ? { summary, resourceLink: link } : { summary, info: result };
    return structuredResult(payload, {
      text: renderResourceSyncInfo(payload),
      ...(link ? { links: [link] } : {}),
    });
  },
});

registerToolDefinition(getResourceSyncInfoTool);

// ============================================================================
// Lifecycle (consolidated action)
// ============================================================================

export const resourceSyncActionTool = defineTool({
  name: "komodo_resource_sync_action",
  description:
    "Lifecycle action on a Komodo ResourceSync. 'run' executes the sync (applies pending changes — long-running, polled). 'refresh' updates the pending-changes preview without applying anything.",
  input: resourceSyncActionInputSchema,
  output: resourceSyncActionOutputSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.RESOURCE_SYNC },
  requiredScopes: [ToolScopes.OPERATE],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "run") {
      const update = await wrapExecuteAndPoll(`run resource sync '${args.resource_sync}'`, () =>
        komodo.client.execute("RunSync", { sync: args.resource_sync }),
      );
      const payload = buildActionResult(update, "deploy", "resource_sync", args.resource_sync);
      return structuredResult(payload, {
        text: renderActionResult(payload, { updateId: extractUpdateId(update), logs: update.logs }),
      });
    }
    // refresh — fire-and-forget; returns the updated ResourceSync resource
    // (carries the same pending-diff TOML with secret variable values as *_info).
    const result = redactResourceSync(
      await wrapApiCall("refreshResourceSyncPending", () =>
        komodo.client.write("RefreshResourceSyncPending", { sync: args.resource_sync }),
      ),
    );
    const header = formatActionResponse({
      action: "update",
      resourceType: "resource_sync",
      resourceId: args.resource_sync,
    });
    const payload = {
      success: true,
      status: "Complete",
      action: "refresh",
      resource_type: "resource_sync",
      resource_id: args.resource_sync,
    };
    return structuredResult(payload, {
      text: `${header} (pending preview refreshed)\n\n${JSON.stringify(result, null, 2)}`,
    });
  },
});

registerToolDefinition(resourceSyncActionTool);

// ============================================================================
// CRUD
// ============================================================================

export const applyResourceSyncTool = defineTool({
  name: "komodo_resource_sync_apply",
  description: [
    "Create or update a Komodo ResourceSync (PATCH-style on update). Not executed automatically — call `komodo_resource_sync_action` with action='run' afterwards.",
    'action="create": new sync. Required: name. Provide `config` with repo+branch+resource_path or inline file_contents.',
    'action="update": existing sync (`resource_sync` required). Only fields in `config` change.',
  ].join("\n"),
  input: resourceSyncApplyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.RESOURCE_SYNC },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "create") {
      if (!args.name) throw AppErrorFactory.validation.fieldRequired("name");
      const name = args.name;
      const result = await wrapApiCall(
        "createResourceSync",
        // @type-variance — open record → SDK _PartialResourceSyncConfig
        () =>
          komodo.client.write("CreateResourceSync", { name, config: args.config as Types._PartialResourceSyncConfig }),
      );
      const built = buildApplyResult("create", "resource_sync", name, result);
      return structuredResult(built.payload, { text: built.text });
    }
    if (!args.resource_sync) throw AppErrorFactory.validation.fieldRequired("resource_sync");
    const syncId = args.resource_sync;
    const result = await wrapApiCall(
      "updateResourceSync",
      // @type-variance — open record → SDK _PartialResourceSyncConfig
      () =>
        komodo.client.write("UpdateResourceSync", {
          id: syncId,
          config: args.config as Types._PartialResourceSyncConfig,
        }),
    );
    const built = buildApplyResult("update", "resource_sync", syncId, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(applyResourceSyncTool);

export const deleteResourceSyncTool = defineTool({
  name: "komodo_resource_sync_delete",
  description: "Unregister a ResourceSync from Komodo. Resources created via previous syncs are not removed.",
  input: z.object({
    resource_sync: resourceSyncIdSchema.describe("ResourceSync id or name to delete"),
  }),
  output: deleteResultSchema,
  annotations: { destructiveHint: true },
  guardrail: "destructive",
  _meta: { category: ToolCategories.RESOURCE_SYNC },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("deleteResourceSync", () =>
      komodo.client.write("DeleteResourceSync", { id: args.resource_sync }),
    );
    const built = buildDeleteResult("resource_sync", args.resource_sync, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(deleteResourceSyncTool);
