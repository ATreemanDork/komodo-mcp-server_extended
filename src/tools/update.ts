/**
 * Update Tools (read-only)
 *
 * Tools for querying Komodo's update history. Updates are the audit log of all
 * operations performed by Komodo (deploys, builds, syncs, …).
 *
 * Tools (2):
 * - `komodo_update_list` — list updates (paginated, filterable by operation/target)
 * - `komodo_update_info` — full update payload including per-stage logs
 *
 * Note: ListUpdates uses **page-based** pagination on the Komodo backend (not cursor-based).
 * We expose `cursor` as an opaque string that encodes the next page number for API-shape consistency.
 *
 * Ported from the reference repo
 * (references/komodo-mcp-server/src/tools/update.ts) onto this repo's own
 * `@modelcontextprotocol/sdk` integration — see the dispatch contract's
 * mechanical conversion rules (Zod import, `structured`→`structuredResult`,
 * dropped cancellation/progress-reporting plumbing) for the shape of the
 * changes relative to the reference. This domain is read-only (no lifecycle
 * action, no apply/delete) so it does not use `wrapExecuteAndPoll` /
 * `buildActionResult` / `AppErrorFactory`.
 *
 * @module tools/update
 */

import { z } from "zod";
import { Types } from "komodo_client";
import { defineTool } from "../mcp/define-tool.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { ToolCategories, ToolScopes, config } from "../config/index.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { redactObject } from "../utils/redact.js";
import { tryRegisterResource } from "../utils/resource-link.js";
import { renderUpdateList, renderUpdateInfo } from "./renderers/update.js";
import {
  updateIdSchema,
  updateListOutputSchema,
  updateInfoOutputSchema,
  updateListInputSchema,
} from "./schemas/update.js";
import { inlineFullInputSchema } from "./schemas/shared.js";

type UpdateListItem = Types.UpdateListItem;
type UpdateFull = Types.Update;

function projectListItem(u: UpdateListItem) {
  return {
    id: u.id,
    operation: u.operation,
    status: u.status,
    success: u.success,
    start_ts: u.start_ts,
    target_type: u.target.type,
    ...(u.target.id ? { target_id: u.target.id } : {}),
    ...(u.username ? { username: u.username } : {}),
  };
}

function projectFullSummary(u: UpdateFull) {
  return {
    id: u._id?.$oid ?? "",
    operation: u.operation,
    status: u.status,
    success: u.success,
    start_ts: u.start_ts,
    ...(u.end_ts ? { end_ts: u.end_ts } : {}),
    target_type: u.target.type,
    ...(u.target.id ? { target_id: u.target.id } : {}),
    ...(u.operator ? { username: u.operator } : {}),
  };
}

// ============================================================================
// List
// ============================================================================

export const listUpdatesTool = defineTool({
  name: "komodo_update_list",
  description:
    "List Komodo update history (audit log of operations like Deploy/RunBuild/RunSync). Newest first. Supports filtering by operation name and resource target. Pagination uses an opaque cursor string (Komodo backend is page-based).",
  input: updateListInputSchema,
  output: updateListOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.UPDATE },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();

    // Decode opaque cursor → page number (Komodo's pagination model is integer page index).
    let page: number | undefined;
    if (args.cursor !== undefined) {
      const n = Number(args.cursor);
      if (Number.isFinite(n) && n >= 0) page = Math.floor(n);
    }

    // Build a Mongo-style query for the optional filters.
    const query: Record<string, unknown> = {};
    if (args.operation) query["operation"] = args.operation;
    if (args.target_type) query["target.type"] = args.target_type;
    if (args.target_id) query["target.id"] = args.target_id;

    // `MongoDocument` is `any` in the Komodo SDK, so `query` (already
    // `Record<string, unknown>`) needs no cast — casting to an `any` alias
    // would trigger `no-unsafe-assignment`.
    const params: Types.ListUpdates = {
      ...(page !== undefined && { page }),
      ...(Object.keys(query).length > 0 && { query }),
    };

    const result = await wrapApiCall("listUpdates", () => komodo.client.read("ListUpdates", params));

    const allItems = result.updates.map(projectListItem);
    // Respect requested page_size by truncating; Komodo's server-side page size is fixed (~20).
    const limit = args.page_size ?? allItems.length;
    const items = allItems.slice(0, limit);

    const pageInfo = result.next_page !== undefined ? { next_cursor: String(result.next_page) } : undefined;

    const payload = { items, ...(pageInfo && { page: pageInfo }) };
    return structuredResult(payload, { text: renderUpdateList(payload) });
  },
});

registerToolDefinition(listUpdatesTool);

// ============================================================================
// Info
// ============================================================================

export const getUpdateInfoTool = defineTool({
  name: "komodo_update_info",
  description: "Get the full update payload for a single operation, including per-stage logs (stdout/stderr).",
  input: z
    .object({
      id: updateIdSchema,
    })
    .merge(inlineFullInputSchema),
  output: updateInfoOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.UPDATE },
  requiredScopes: [ToolScopes.READ],
  handler: async (args, { sessionId }) => {
    const komodo = requireClient();
    const result = redactObject(await wrapApiCall("getUpdate", () => komodo.client.read("GetUpdate", { id: args.id })));
    const summary = projectFullSummary(result);
    const link = tryRegisterResource({
      ctx: { sessionId },
      category: "info",
      name: `Update ${summary.id || args.id} (${summary.operation})`,
      mimeType: "application/json",
      content: JSON.stringify(result, null, 2),
      ttlMs: config.KOMODO_RESOURCE_TTL_INFO,
      inlineFull: args.inline_full,
      description: `Full update payload with per-stage logs`,
    });
    const payload = link ? { summary, resourceLink: link } : { summary, info: result };
    return structuredResult(payload, {
      text: renderUpdateInfo(payload),
      ...(link ? { links: [link] } : {}),
    });
  },
});

registerToolDefinition(getUpdateInfoTool);
