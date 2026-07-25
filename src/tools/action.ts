/**
 * Action Tools
 *
 * Tools for managing Komodo Action resources.
 *
 * An Action is a scheduled Deno/TypeScript script that runs against the
 * Komodo API using a pre-initialised `komodo` client. Actions are similar to
 * Procedures but use a single TypeScript script instead of multi-stage
 * execution graphs — useful for ad-hoc automation, scheduled cleanups,
 * webhook-triggered tasks, etc.
 *
 * Tools (5):
 * - `komodo_action_list`   — list registered Actions
 * - `komodo_action_info`   — full Action resource (script body offloaded via ResourceLink)
 * - `komodo_action_action` — run an Action (long-running, polls Update)
 * - `komodo_action_apply`  — create-or-update (discriminated by `action`)
 * - `komodo_action_delete` — unregister an Action
 *
 * Ported from the reference repo
 * (references/komodo-mcp-server/src/tools/action.ts) onto this repo's own
 * `@modelcontextprotocol/sdk` integration — see the dispatch contract's
 * mechanical conversion rules (Zod import, `structured`→`structuredResult`,
 * dropped cancellation/progress-reporting plumbing) for the shape of the
 * changes relative to the reference.
 *
 * @module tools/action
 */

import { z } from "zod";
import { Types } from "komodo_client";
import { defineTool } from "../mcp/define-tool.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { ToolCategories, ToolScopes, config } from "../config/index.js";
import { AppErrorFactory } from "../errors/index.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { redactObject } from "../utils/redact.js";
import { paginate } from "../utils/pagination.js";
import { wrapExecuteAndPoll, buildActionResult, extractUpdateId } from "../utils/polling.js";
import { buildApplyResult, buildDeleteResult } from "../utils/response-formatter.js";
import { tryRegisterResource } from "../utils/resource-link.js";
import { renderActionList, renderActionInfo } from "./renderers/action.js";
import { renderActionResult } from "./renderers/_shared.js";
import {
  actionIdSchema,
  actionListOutputSchema,
  actionInfoOutputSchema,
  actionActionInputSchema,
  actionActionOutputSchema,
  actionApplyInputSchema,
} from "./schemas/action.js";
import {
  applyResultSchema,
  deleteResultSchema,
  inlineFullInputSchema,
  paginationInputSchema,
} from "./schemas/shared.js";

type ActionListItem = Types.ActionListItem;

// ============================================================================
// List
// ============================================================================

export const listActionsTool = defineTool({
  name: "komodo_action_list",
  description:
    "List all Actions registered in Komodo. An Action is a scheduled Deno/TypeScript script that runs against the Komodo API.",
  input: paginationInputSchema,
  output: actionListOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.ACTION },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const actions = await wrapApiCall("listActions", () => komodo.client.read("ListActions", {}));

    const allItems = actions.map((a: ActionListItem) => ({
      id: a.id,
      name: a.name,
      state: a.info.state,
      ...(a.info.last_run_at ? { last_run_at: a.info.last_run_at } : {}),
      ...(a.info.next_scheduled_run ? { next_scheduled_run: a.info.next_scheduled_run } : {}),
      ...(a.info.schedule_error ? { schedule_error: a.info.schedule_error } : {}),
    }));

    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderActionList(payload) });
  },
});

registerToolDefinition(listActionsTool);

// ============================================================================
// Info
// ============================================================================

export const getActionInfoTool = defineTool({
  name: "komodo_action_info",
  description:
    "Get the full Komodo Action resource (script body, schedule, webhook config). The TypeScript script body is offloaded via a session-scoped resource link when available.",
  input: z
    .object({
      action_id: actionIdSchema.describe("Action id or name"),
    })
    .merge(inlineFullInputSchema),
  output: actionInfoOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.ACTION },
  requiredScopes: [ToolScopes.READ],
  handler: async (args, { sessionId }) => {
    const komodo = requireClient();
    const result = redactObject(
      await wrapApiCall("getAction", () => komodo.client.read("GetAction", { action: args.action_id })),
    );
    const link = tryRegisterResource({
      ctx: { sessionId },
      category: "info",
      name: `${result.name} (action info)`,
      mimeType: "application/json",
      content: JSON.stringify(result, null, 2),
      ttlMs: config.KOMODO_RESOURCE_TTL_INFO,
      inlineFull: args.inline_full,
      description: `Full Action resource for ${result.name}`,
    });
    const summary = {
      id: result._id?.$oid ?? args.action_id,
      name: result.name,
    };
    const payload = link ? { summary, resourceLink: link } : { summary, info: result };
    return structuredResult(payload, {
      text: renderActionInfo(payload),
      ...(link ? { links: [link] } : {}),
    });
  },
});

registerToolDefinition(getActionInfoTool);

// ============================================================================
// Action
// ============================================================================

export const actionActionTool = defineTool({
  name: "komodo_action_action",
  description:
    "Run a Komodo Action end-to-end (long-running — polls until the underlying Update reaches Complete and returns the run logs). action='run' is currently the only verb.",
  input: actionActionInputSchema,
  output: actionActionOutputSchema,
  annotations: { readOnlyHint: false, idempotentHint: false },
  _meta: { category: ToolCategories.ACTION },
  requiredScopes: [ToolScopes.OPERATE],
  handler: async (args) => {
    const komodo = requireClient();
    const update = await wrapExecuteAndPoll(`${args.action} action '${args.action_id}'`, () =>
      komodo.client.execute("RunAction", {
        action: args.action_id,
        // `args.args` is already `Record<string, unknown>` per the Zod schema;
        // Komodo SDK's `JsonObject` is `any`, so no cast is needed (and casting
        // to an `any` alias would trigger `no-unsafe-assignment`).
        ...(args.args ? { args: args.args } : {}),
      }),
    );
    const payload = buildActionResult(update, args.action, "action", args.action_id);
    return structuredResult(payload, {
      text: renderActionResult(payload, { updateId: extractUpdateId(update), logs: update.logs }),
    });
  },
});

registerToolDefinition(actionActionTool);

// ============================================================================
// CRUD
// ============================================================================

export const applyActionTool = defineTool({
  name: "komodo_action_apply",
  description: [
    "Create or update a Komodo Action (PATCH-style). An Action is a scheduled Deno/TypeScript script that runs against the Komodo API.",
    'action="create": new Action. Required: name.',
    'action="update": existing Action (`action_id` required). Only fields in `config` change.',
  ].join("\n"),
  input: actionApplyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.ACTION },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "create") {
      if (!args.name) throw AppErrorFactory.validation.fieldRequired("name");
      const name = args.name;
      const result = await wrapApiCall(
        "createAction",
        // @type-variance — Zod-inferred optional fields → SDK `_PartialActionConfig` (string-literal enum overlap).
        () =>
          komodo.client.write("CreateAction", {
            name,
            config: (args.config ?? {}) as unknown as Types._PartialActionConfig,
          }),
      );
      const built = buildApplyResult("create", "action", name, result);
      return structuredResult(built.payload, { text: built.text });
    }
    if (!args.action_id) throw AppErrorFactory.validation.fieldRequired("action_id");
    const actionId = args.action_id;
    const result = await wrapApiCall(
      "updateAction",
      // @type-variance — Zod-inferred optional fields → SDK `_PartialActionConfig` (string-literal enum overlap).
      () =>
        komodo.client.write("UpdateAction", {
          id: actionId,
          config: args.config as unknown as Types._PartialActionConfig,
        }),
    );
    const built = buildApplyResult("update", "action", actionId, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(applyActionTool);

export const deleteActionTool = defineTool({
  name: "komodo_action_delete",
  description: "Unregister an Action from Komodo. Cancels any future scheduled runs.",
  input: z.object({
    action_id: actionIdSchema.describe("Action id or name to delete"),
  }),
  output: deleteResultSchema,
  annotations: { destructiveHint: true },
  guardrail: "destructive",
  _meta: { category: ToolCategories.ACTION },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("deleteAction", () => komodo.client.write("DeleteAction", { id: args.action_id }));
    const built = buildDeleteResult("action", args.action_id, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(deleteActionTool);
