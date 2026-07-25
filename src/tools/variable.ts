/**
 * Variable Tools
 *
 * Tools for managing Komodo global Variables. Variables can be interpolated
 * into Stack/Deployment configs via `[[variable.name]]` syntax. A secret
 * variable's value is always masked to `[redacted]` before it reaches the
 * calling model — this server is admin-scoped to Komodo, so masking is
 * unconditional on `is_secret` (see `redactVariable`), not gated by the
 * caller's admin status the way Komodo Core's own API is.
 *
 * Tools (4):
 * - `komodo_variable_list`   — list variables
 * - `komodo_variable_info`   — get a variable
 * - `komodo_variable_apply`  — create-or-update (dispatches to UpdateVariableValue/Description/IsSecret on update)
 * - `komodo_variable_delete` — delete a variable
 *
 * Ported from the reference repo
 * (references/komodo-mcp-server/src/tools/variable.ts) onto this repo's own
 * `@modelcontextprotocol/sdk` integration — see the dispatch contract's
 * mechanical conversion rules (Zod import, `structured`→`structuredResult`,
 * dropped cancellation/progress-reporting plumbing) for the shape of the
 * changes relative to the reference.
 *
 * @module tools/variable
 */

import { z } from "zod";
import { Types } from "komodo_client";
import { defineTool } from "../mcp/define-tool.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { ToolCategories, ToolScopes } from "../config/index.js";
import { AppErrorFactory } from "../errors/index.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { paginate } from "../utils/pagination.js";
import { buildApplyResult, buildDeleteResult } from "../utils/response-formatter.js";
import { REDACTED } from "../utils/redact.js";
import { renderVariableList, renderVariableInfo } from "./renderers/variable.js";
import {
  variableNameSchema,
  variableListOutputSchema,
  variableInfoOutputSchema,
  variableApplyInputSchema,
} from "./schemas/variable.js";
import { applyResultSchema, deleteResultSchema, paginationInputSchema } from "./schemas/shared.js";

type Variable = Types.Variable;

/**
 * Mask a Variable's `value` when it is secret. `value` is NOT a
 * key-name-signalled secret, so the shared `redactObject` choke point can't
 * see it — its secrecy depends on the sibling `is_secret` flag. So the domain
 * masks it here (mirroring Provider's `has_token` mapper), for every path that
 * echoes a Variable: list/info projection and the apply/delete result. The
 * server authenticates to Komodo with an admin credential, so Core returns the
 * real value to it regardless of the "redacted for non-admin users" behavior —
 * the model is the consumer, so we mask unconditionally on `is_secret`.
 */
function redactVariable(v: Variable): Variable {
  return v.is_secret ? { ...v, value: REDACTED } : v;
}

function projectVariable(v: Variable): {
  name: string;
  value: string;
  description?: string;
  is_secret?: boolean;
} {
  return {
    name: v.name,
    value: v.is_secret ? REDACTED : (v.value ?? ""),
    ...(v.description !== undefined && v.description !== "" ? { description: v.description } : {}),
    ...(v.is_secret ? { is_secret: true } : {}),
  };
}

// ============================================================================
// List
// ============================================================================

export const listVariablesTool = defineTool({
  name: "komodo_variable_list",
  description:
    "List all global variables registered in Komodo. Secret variables' values are always masked to [redacted] in the response (unconditional — this server is admin-scoped to Komodo).",
  input: paginationInputSchema,
  output: variableListOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.VARIABLE },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const variables = await wrapApiCall("listVariables", () => komodo.client.read("ListVariables", {}));
    const allItems = variables.map(projectVariable);
    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderVariableList(payload) });
  },
});

registerToolDefinition(listVariablesTool);

// ============================================================================
// Info
// ============================================================================

export const getVariableInfoTool = defineTool({
  name: "komodo_variable_info",
  description:
    "Get a single Komodo variable. A secret variable's value is always masked to [redacted] in the response (unconditional — this server is admin-scoped to Komodo).",
  input: z.object({
    name: variableNameSchema,
  }),
  output: variableInfoOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.VARIABLE },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("getVariable", () => komodo.client.read("GetVariable", { name: args.name }));
    const payload = { variable: projectVariable(result) };
    return structuredResult(payload, { text: renderVariableInfo(payload) });
  },
});

registerToolDefinition(getVariableInfoTool);

// ============================================================================
// CRUD
// ============================================================================

export const applyVariableTool = defineTool({
  name: "komodo_variable_apply",
  description: [
    "Create or update a Komodo Variable (PATCH-style on update).",
    'action="create": new variable. Required: name. Optional: value, description, is_secret.',
    'action="update": existing variable (name required). Each of value, description, is_secret triggers a separate update call when provided.',
  ].join("\n"),
  input: variableApplyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.VARIABLE },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "create") {
      const params: Types.CreateVariable = {
        name: args.name,
        ...(args.value !== undefined && { value: args.value }),
        ...(args.description !== undefined && { description: args.description }),
        ...(args.is_secret !== undefined && { is_secret: args.is_secret }),
      };
      const result = await wrapApiCall("createVariable", () => komodo.client.write("CreateVariable", params));
      const built = buildApplyResult("create", "variable", args.name, redactVariable(result));
      return structuredResult(built.payload, { text: built.text });
    }
    // update — dispatch to one or more endpoints based on which fields are set
    if (args.value === undefined && args.description === undefined && args.is_secret === undefined) {
      throw AppErrorFactory.validation.fieldRequired("value | description | is_secret");
    }
    let updated: Variable | undefined;
    if (args.value !== undefined) {
      const value = args.value;
      updated = await wrapApiCall("updateVariableValue", () =>
        komodo.client.write("UpdateVariableValue", { name: args.name, value }),
      );
    }
    if (args.description !== undefined) {
      const description = args.description;
      updated = await wrapApiCall("updateVariableDescription", () =>
        komodo.client.write("UpdateVariableDescription", { name: args.name, description }),
      );
    }
    if (args.is_secret !== undefined) {
      const is_secret = args.is_secret;
      updated = await wrapApiCall("updateVariableIsSecret", () =>
        komodo.client.write("UpdateVariableIsSecret", { name: args.name, is_secret }),
      );
    }
    const built = buildApplyResult(
      "update",
      "variable",
      args.name,
      updated === undefined ? undefined : redactVariable(updated),
    );
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(applyVariableTool);

export const deleteVariableTool = defineTool({
  name: "komodo_variable_delete",
  description:
    "Delete a Komodo Variable. Stacks/Deployments referencing it via `[[variable.name]]` will fail to interpolate afterwards.",
  input: z.object({
    name: variableNameSchema,
  }),
  output: deleteResultSchema,
  annotations: { destructiveHint: true },
  guardrail: "destructive",
  _meta: { category: ToolCategories.VARIABLE },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("deleteVariable", () =>
      komodo.client.write("DeleteVariable", { name: args.name }),
    );
    const built = buildDeleteResult("variable", args.name, redactVariable(result));
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(deleteVariableTool);
