/**
 * Deployment Tools
 *
 * Tools for managing single-container Komodo deployments.
 *
 * Tools (5):
 * - `komodo_deployment_list`    — list deployments
 * - `komodo_deployment_info`    — detailed deployment information
 * - `komodo_deployment_apply`   — create-or-update (discriminated by `action`)
 * - `komodo_deployment_delete`  — remove deployment from Komodo
 * - `komodo_deployment_action`  — consolidated lifecycle (deploy/pull/start/restart/pause/unpause/stop/destroy)
 *
 * Ported from the reference repo
 * (references/komodo-mcp-server/src/tools/deployment.ts) onto this repo's
 * own `@modelcontextprotocol/sdk` integration — see the dispatch contract's
 * mechanical conversion rules (Zod import, `structured`→`structuredResult`,
 * dropped cancellation/progress-reporting plumbing) for the shape of the
 * changes relative to the reference.
 *
 * @module tools/deployment
 */

import { z } from "zod";
import { Types } from "komodo_client";
import { defineTool } from "../mcp/define-tool.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { PARAM_DESCRIPTIONS, ToolCategories, ToolScopes, config } from "../config/index.js";
import { destructiveWhenActionIn } from "../guardrails/policy.js";
import { AppErrorFactory } from "../errors/index.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { paginate } from "../utils/pagination.js";
import { wrapExecuteAndPoll, buildActionResult, extractUpdateId } from "../utils/polling.js";
import { buildApplyResult, buildDeleteResult } from "../utils/response-formatter.js";
import { tryRegisterResource } from "../utils/resource-link.js";
import { redactObject } from "../utils/redact.js";
import { renderDeploymentList, renderDeploymentInfo } from "./renderers/deployment.js";
import { renderActionResult } from "./renderers/_shared.js";
import {
  deploymentApplyInputSchema,
  deploymentActionInputSchema,
  deploymentListOutputSchema,
  deploymentInfoOutputSchema,
} from "./schemas/deployment.js";
import { deploymentIdSchema } from "./schemas/validators.js";
import {
  actionResultSchema,
  applyResultSchema,
  deleteResultSchema,
  inlineFullInputSchema,
  paginationInputSchema,
} from "./schemas/shared.js";

type DeploymentListItem = Types.DeploymentListItem;

// ============================================================================
// List
// ============================================================================

export const listDeploymentsTool = defineTool({
  name: "komodo_deployment_list",
  description:
    "List all Komodo-managed deployments. Deployments are single-container applications managed by Komodo. " +
    "Shows deployment name, ID, and current state.",
  input: paginationInputSchema,
  output: deploymentListOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.DEPLOYMENT },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const deployments = await wrapApiCall("list deployments", () => komodo.client.read("ListDeployments", {}));
    const allItems = deployments.map((d: DeploymentListItem) => ({
      id: d.id,
      name: d.name,
      state: d.info.state,
      ...(d.info.server_id ? { server_id: d.info.server_id } : {}),
    }));
    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderDeploymentList(payload) });
  },
});

registerToolDefinition(listDeploymentsTool);

// ============================================================================
// Info / CRUD
// ============================================================================

export const getDeploymentInfoTool = defineTool({
  name: "komodo_deployment_info",
  description:
    "Get detailed information about a Komodo-managed deployment, including its configuration, current state, and assigned server.",
  input: z
    .object({
      deployment: deploymentIdSchema.describe(PARAM_DESCRIPTIONS.DEPLOYMENT_ID_FOR_INFO),
    })
    .merge(inlineFullInputSchema),
  output: deploymentInfoOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.DEPLOYMENT },
  requiredScopes: [ToolScopes.READ],
  handler: async (args, { sessionId }) => {
    const komodo = requireClient();
    const result = redactObject(
      await wrapApiCall("getDeployment", () => komodo.client.read("GetDeployment", { deployment: args.deployment })),
    );
    const link = tryRegisterResource({
      ctx: { sessionId },
      category: "info",
      name: `${args.deployment} (deployment info)`,
      mimeType: "application/json",
      content: JSON.stringify(result, null, 2),
      ttlMs: config.KOMODO_RESOURCE_TTL_INFO,
      inlineFull: args.inline_full,
      description: `Full deployment resource for ${args.deployment}`,
    });
    const summary = { id: args.deployment, name: args.deployment };
    const payload = link ? { summary, resourceLink: link } : { summary, info: result };
    return structuredResult(payload, {
      text: renderDeploymentInfo(payload),
      ...(link ? { links: [link] } : {}),
    });
  },
});

registerToolDefinition(getDeploymentInfoTool);

export const applyDeploymentTool = defineTool({
  name: "komodo_deployment_apply",
  description: [
    "Create or update a Komodo deployment (Docker container, PATCH-style).",
    'action="create": new deployment. Required: name. Recommended: server_id, image.',
    'action="update": existing deployment (`deployment` required). Only fields in `config` change.',
    'Image accepts a string ("nginx:1.25") or { type: "Image"|"Build", params: {…} }.',
  ].join("\n"),
  input: deploymentApplyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.DEPLOYMENT },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "create") {
      if (!args.name) throw AppErrorFactory.validation.fieldRequired("name");
      const name = args.name;
      const deploymentConfig: Record<string, unknown> = { ...args.config };
      if (args.server_id) deploymentConfig.server_id = args.server_id;
      if (args.image) {
        deploymentConfig.image =
          typeof args.image === "string" ? { type: "Image", params: { image: args.image } } : args.image;
      }
      const result = await wrapApiCall("createDeployment", () =>
        komodo.client.write("CreateDeployment", { name, config: deploymentConfig }),
      );
      const built = buildApplyResult("create", "deployment", name, result);
      return structuredResult(built.payload, { text: built.text });
    }
    if (!args.deployment) throw AppErrorFactory.validation.fieldRequired("deployment");
    const deploymentId = args.deployment;
    const result = await wrapApiCall(
      "updateDeployment",
      // @type-variance — Zod-inferred optional fields (`T | undefined`) → SDK `Partial<DeploymentConfig>` (`T`).
      () =>
        komodo.client.write("UpdateDeployment", {
          id: deploymentId,
          config: args.config as Types._PartialDeploymentConfig,
        }),
    );
    const built = buildApplyResult("update", "deployment", deploymentId, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(applyDeploymentTool);

export const deleteDeploymentTool = defineTool({
  name: "komodo_deployment_delete",
  description:
    "Delete a Komodo deployment. Removes the deployment configuration and stops/removes the associated container.",
  input: z.object({
    deployment: deploymentIdSchema.describe(PARAM_DESCRIPTIONS.DEPLOYMENT_ID),
  }),
  output: deleteResultSchema,
  annotations: { destructiveHint: true },
  guardrail: "destructive",
  _meta: { category: ToolCategories.DEPLOYMENT },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("deleteDeployment", () =>
      komodo.client.write("DeleteDeployment", { id: args.deployment }),
    );
    const built = buildDeleteResult("deployment", args.deployment, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(deleteDeploymentTool);

// ============================================================================
// Lifecycle
// ============================================================================

/** Maps the action enum to the corresponding Komodo execute API name. */
const DEPLOYMENT_ACTION_API_MAP = {
  deploy: "Deploy",
  pull: "PullDeployment",
  start: "StartDeployment",
  restart: "RestartDeployment",
  pause: "PauseDeployment",
  unpause: "UnpauseDeployment",
  stop: "StopDeployment",
  destroy: "DestroyDeployment",
} as const satisfies Record<
  z.infer<typeof deploymentActionInputSchema>["action"],
  | "Deploy"
  | "PullDeployment"
  | "StartDeployment"
  | "RestartDeployment"
  | "PauseDeployment"
  | "UnpauseDeployment"
  | "StopDeployment"
  | "DestroyDeployment"
>;

export const deploymentActionTool = defineTool({
  name: "komodo_deployment_action",
  description:
    "Lifecycle action on a deployment: deploy (recreate container), pull (image only), start, restart, pause, unpause, stop, destroy (remove container). destroy is destructive; config preserved.",
  input: deploymentActionInputSchema,
  output: actionResultSchema,
  annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
  guardrail: destructiveWhenActionIn(["destroy"]),
  _meta: { category: ToolCategories.DEPLOYMENT },
  requiredScopes: [ToolScopes.OPERATE],
  handler: async (args) => {
    const komodo = requireClient();
    const apiAction = DEPLOYMENT_ACTION_API_MAP[args.action];
    const update = await wrapExecuteAndPoll(`${args.action} deployment`, () =>
      komodo.client.execute(apiAction, { deployment: args.deployment }),
    );
    const payload = buildActionResult(update, args.action, "deployment", args.deployment);
    return structuredResult(payload, {
      text: renderActionResult(payload, { updateId: extractUpdateId(update), logs: update.logs }),
    });
  },
});

registerToolDefinition(deploymentActionTool);
