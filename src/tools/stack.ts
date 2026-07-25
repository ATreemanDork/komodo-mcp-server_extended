/**
 * Stack Tools
 *
 * Tools for listing, managing, and controlling Docker Compose stacks in Komodo.
 *
 * Tools (5):
 * - `komodo_stack_list`     — list stacks
 * - `komodo_stack_info`     — detailed stack information
 * - `komodo_stack_apply`    — create-or-update (discriminated by `action`)
 * - `komodo_stack_delete`   — remove stack from Komodo
 * - `komodo_stack_action`   — consolidated lifecycle (deploy/pull/start/restart/pause/unpause/stop/destroy)
 *
 * Ported from the reference repo
 * (references/komodo-mcp-server/src/tools/stack.ts) onto this repo's own
 * `@modelcontextprotocol/sdk` integration — see the dispatch contract's
 * mechanical conversion rules (Zod import, `structured`→`structuredResult`,
 * dropped cancellation/progress-reporting plumbing) for the shape of the
 * changes relative to the reference.
 *
 * @module tools/stack
 */

import { z } from "zod";
import { Types } from "komodo_client";
import { defineTool } from "../mcp/define-tool.js";
import { destructiveWhenActionIn } from "../guardrails/policy.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { PARAM_DESCRIPTIONS, ToolCategories, ToolScopes, config } from "../config/index.js";
import { AppErrorFactory } from "../errors/index.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { paginate } from "../utils/pagination.js";
import { wrapExecuteAndPoll, buildActionResult, extractUpdateId } from "../utils/polling.js";
import { buildApplyResult, buildDeleteResult } from "../utils/response-formatter.js";
import { tryRegisterResource } from "../utils/resource-link.js";
import { redactObject } from "../utils/redact.js";
import { renderStackList, renderStackInfo } from "./renderers/stack.js";
import { renderActionResult } from "./renderers/_shared.js";
import {
  stackApplyInputSchema,
  stackActionInputSchema,
  stackListOutputSchema,
  stackInfoOutputSchema,
} from "./schemas/stack.js";
import { stackIdSchema } from "./schemas/validators.js";
import {
  actionResultSchema,
  applyResultSchema,
  deleteResultSchema,
  inlineFullInputSchema,
  paginationInputSchema,
} from "./schemas/shared.js";

type StackListItem = Types.StackListItem;

// ============================================================================
// List
// ============================================================================

export const listStacksTool = defineTool({
  name: "komodo_stack_list",
  description: "List all Komodo-managed Compose stacks. Shows stack name, ID, and current state.",
  input: paginationInputSchema,
  output: stackListOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.STACK },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const stacks = await wrapApiCall("list stacks", () => komodo.client.read("ListStacks", {}));
    const allItems = stacks.map((s: StackListItem) => ({
      id: s.id,
      name: s.name,
      state: s.info.state,
      ...(s.info.server_id ? { server_id: s.info.server_id } : {}),
    }));
    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderStackList(payload) });
  },
});

registerToolDefinition(listStacksTool);

// ============================================================================
// Info / CRUD
// ============================================================================

export const getStackInfoTool = defineTool({
  name: "komodo_stack_info",
  description:
    "Get detailed information about a Compose stack including configuration, current state, compose file contents, services, and environment variables.",
  input: z
    .object({
      stack: stackIdSchema.describe(PARAM_DESCRIPTIONS.STACK_ID_FOR_INFO),
    })
    .merge(inlineFullInputSchema),
  output: stackInfoOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.STACK },
  requiredScopes: [ToolScopes.READ],
  handler: async (args, { sessionId }) => {
    const komodo = requireClient();
    const result = redactObject(
      await wrapApiCall("getStackInfo", () => komodo.client.read("GetStack", { stack: args.stack })),
    );
    const link = tryRegisterResource({
      ctx: { sessionId },
      category: "info",
      name: `${args.stack} (stack info)`,
      mimeType: "application/json",
      content: JSON.stringify(result, null, 2),
      ttlMs: config.KOMODO_RESOURCE_TTL_INFO,
      inlineFull: args.inline_full,
      description: `Full stack resource for ${args.stack}`,
    });
    const summary = { id: args.stack, name: args.stack };
    const payload = link ? { summary, resourceLink: link } : { summary, info: result };
    return structuredResult(payload, {
      text: renderStackInfo(payload),
      ...(link ? { links: [link] } : {}),
    });
  },
});

registerToolDefinition(getStackInfoTool);

export const applyStackTool = defineTool({
  name: "komodo_stack_apply",
  description: [
    "Create or update a Docker Compose stack in Komodo (PATCH-style).",
    'action="create": new stack. Required: name. Recommended: server_id (Compose) or swarm_id (Swarm).',
    'action="update": existing stack (`stack` required). Only fields in `config` change.',
    "File source on create: file_contents | repo+branch | files_on_host.",
  ].join("\n"),
  input: stackApplyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.STACK },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "create") {
      if (!args.name) throw AppErrorFactory.validation.fieldRequired("name");
      const name = args.name;
      const stackConfig: Record<string, unknown> = { ...args.config };
      if (args.server_id) stackConfig.server_id = args.server_id;
      const result = await wrapApiCall("createStack", () =>
        komodo.client.write("CreateStack", { name, config: stackConfig }),
      );
      const built = buildApplyResult("create", "stack", name, result);
      return structuredResult(built.payload, { text: built.text });
    }
    if (!args.stack) throw AppErrorFactory.validation.fieldRequired("stack");
    const stackId = args.stack;
    const result = await wrapApiCall(
      "updateStack",
      // @type-variance — Zod-inferred optional fields (`T | undefined`) → SDK `Partial<StackConfig>` (`T`).
      () =>
        komodo.client.write("UpdateStack", {
          id: stackId,
          config: args.config as Types._PartialStackConfig,
        }),
    );
    const built = buildApplyResult("update", "stack", stackId, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(applyStackTool);

export const deleteStackTool = defineTool({
  name: "komodo_stack_delete",
  description:
    "Delete a Compose stack from Komodo. This removes the stack configuration but does not affect running containers.",
  input: z.object({
    stack: stackIdSchema.describe(PARAM_DESCRIPTIONS.STACK_ID),
  }),
  output: deleteResultSchema,
  annotations: { destructiveHint: true },
  guardrail: "destructive",
  _meta: { category: ToolCategories.STACK },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("deleteStack", () => komodo.client.write("DeleteStack", { id: args.stack }));
    const built = buildDeleteResult("stack", args.stack, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(deleteStackTool);

// ============================================================================
// Lifecycle
// ============================================================================

/** Maps the action enum to the corresponding Komodo execute API name. */
const STACK_ACTION_API_MAP = {
  deploy: "DeployStack",
  pull: "PullStack",
  start: "StartStack",
  restart: "RestartStack",
  pause: "PauseStack",
  unpause: "UnpauseStack",
  stop: "StopStack",
  destroy: "DestroyStack",
} as const satisfies Record<
  z.infer<typeof stackActionInputSchema>["action"],
  | "DeployStack"
  | "PullStack"
  | "StartStack"
  | "RestartStack"
  | "PauseStack"
  | "UnpauseStack"
  | "StopStack"
  | "DestroyStack"
>;

export const stackActionTool = defineTool({
  name: "komodo_stack_action",
  description:
    "Lifecycle action on a Compose stack: deploy (up), pull, start, restart, pause, unpause, stop, destroy (down — removes containers). destroy is destructive; config preserved.",
  input: stackActionInputSchema,
  output: actionResultSchema,
  annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
  guardrail: destructiveWhenActionIn(["destroy"]),
  _meta: { category: ToolCategories.STACK },
  requiredScopes: [ToolScopes.OPERATE],
  handler: async (args) => {
    const komodo = requireClient();
    const apiAction = STACK_ACTION_API_MAP[args.action];
    const update = await wrapExecuteAndPoll(`${args.action} stack`, () =>
      komodo.client.execute(apiAction, { stack: args.stack }),
    );
    const payload = buildActionResult(update, args.action, "stack", args.stack);
    return structuredResult(payload, {
      text: renderActionResult(payload, { updateId: extractUpdateId(update), logs: update.logs }),
    });
  },
});

registerToolDefinition(stackActionTool);
