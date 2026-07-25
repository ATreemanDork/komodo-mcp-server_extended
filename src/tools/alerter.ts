/**
 * Alerter Tools
 *
 * Tools for managing Komodo Alerter resources (alert sinks: Slack, Discord, Custom HTTP, ...).
 *
 * Tools (4):
 * - `komodo_alerter_list`   — list registered alerters
 * - `komodo_alerter_info`   — full alerter resource (endpoint URL/headers offloaded via ResourceLink)
 * - `komodo_alerter_apply`  — create-or-update (discriminated by `action`)
 * - `komodo_alerter_delete` — unregister an alerter
 *
 * Ported from the reference repo
 * (references/komodo-mcp-server/src/tools/alerter.ts) onto this repo's own
 * `@modelcontextprotocol/sdk` integration — see the dispatch contract's
 * mechanical conversion rules (Zod import, `structured`→`structuredResult`,
 * dropped cancellation/progress-reporting plumbing) for the shape of the
 * changes relative to the reference.
 *
 * @module tools/alerter
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
import { tryRegisterResource } from "../utils/resource-link.js";
import { redactObject, REDACTED } from "../utils/redact.js";
import { renderAlerterList, renderAlerterInfo } from "./renderers/alerter.js";
import {
  alerterIdSchema,
  alerterListOutputSchema,
  alerterInfoOutputSchema,
  alerterApplyInputSchema,
} from "./schemas/alerter.js";
import {
  applyResultSchema,
  deleteResultSchema,
  inlineFullInputSchema,
  paginationInputSchema,
} from "./schemas/shared.js";

type AlerterListItem = Types.AlerterListItem;

/**
 * Redact an Alerter for output. `config.endpoint.params` carries provider
 * webhook secrets under non-key-signalled names (e.g. Slack/Discord `url`
 * embeds a token), so `redactObject` alone misses them — mask every value in
 * that params object, then let `redactObject` handle the key-name-signalled
 * fields elsewhere. `config.endpoint.type` and other fields stay intact.
 */
function redactAlerter(a: Types.Alerter): Types.Alerter {
  const redacted = redactObject(a);
  const params = redacted.config?.endpoint?.params as Record<string, unknown> | undefined;
  if (params) {
    for (const key of Object.keys(params)) params[key] = REDACTED;
  }
  return redacted;
}

// ============================================================================
// List
// ============================================================================

export const listAlertersTool = defineTool({
  name: "komodo_alerter_list",
  description:
    "List all alerters registered in Komodo. Alerters are sinks (Slack, Discord, Custom HTTP, ...) that receive alerts when monitored resources change state.",
  input: paginationInputSchema,
  output: alerterListOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.ALERTER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const alerters = await wrapApiCall("listAlerters", () => komodo.client.read("ListAlerters", {}));

    const allItems = alerters.map((a: AlerterListItem) => ({
      id: a.id,
      name: a.name,
      enabled: a.info.enabled,
      endpoint_type: a.info.endpoint_type,
    }));

    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderAlerterList(payload) });
  },
});

registerToolDefinition(listAlertersTool);

// ============================================================================
// Info
// ============================================================================

export const getAlerterInfoTool = defineTool({
  name: "komodo_alerter_info",
  description:
    "Get the full Komodo Alerter resource (endpoint configuration, alert filters, maintenance windows). Sensitive fields like webhook URLs are masked to [redacted] before output — the resource link never carries the raw value; a session-scoped resource link holds the full masked resource when available.",
  input: z
    .object({
      alerter: alerterIdSchema.describe("Alerter id or name"),
    })
    .merge(inlineFullInputSchema),
  output: alerterInfoOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.ALERTER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args, { sessionId }) => {
    const komodo = requireClient();
    const result = redactAlerter(
      await wrapApiCall("getAlerter", () => komodo.client.read("GetAlerter", { alerter: args.alerter })),
    );
    const link = tryRegisterResource({
      ctx: { sessionId },
      category: "info",
      name: `${result.name} (alerter info)`,
      mimeType: "application/json",
      content: JSON.stringify(result, null, 2),
      ttlMs: config.KOMODO_RESOURCE_TTL_INFO,
      inlineFull: args.inline_full,
      description: `Full alerter resource for ${result.name}`,
    });
    const summary = {
      id: result._id?.$oid ?? args.alerter,
      name: result.name,
      ...(result.config?.enabled !== undefined ? { enabled: result.config.enabled } : {}),
      ...(result.config?.endpoint?.type ? { endpoint_type: result.config.endpoint.type } : {}),
    };
    const payload = link ? { summary, resourceLink: link } : { summary, info: result };
    return structuredResult(payload, {
      text: renderAlerterInfo(payload),
      ...(link ? { links: [link] } : {}),
    });
  },
});

registerToolDefinition(getAlerterInfoTool);

// ============================================================================
// CRUD
// ============================================================================

export const applyAlerterTool = defineTool({
  name: "komodo_alerter_apply",
  description: [
    "Create or update a Komodo Alerter (PATCH-style). Alerters route monitoring alerts to external sinks (Slack, Discord, custom HTTP, ...).",
    'action="create": new alerter. Required: name. Provide `config.endpoint` with discriminated `type` and provider params.',
    'action="update": existing alerter (`alerter` required). Only fields in `config` change.',
  ].join("\n"),
  input: alerterApplyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.ALERTER },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "create") {
      if (!args.name) throw AppErrorFactory.validation.fieldRequired("name");
      const name = args.name;
      const result = await wrapApiCall(
        "createAlerter",
        // @type-variance — Zod-inferred optional fields → SDK `_PartialAlerterConfig` (discriminated `endpoint` union).
        () =>
          komodo.client.write("CreateAlerter", {
            name,
            config: (args.config ?? {}) as unknown as Types._PartialAlerterConfig,
          }),
      );
      const built = buildApplyResult("create", "alerter", name, redactAlerter(result));
      return structuredResult(built.payload, { text: built.text });
    }
    if (!args.alerter) throw AppErrorFactory.validation.fieldRequired("alerter");
    const alerterId = args.alerter;
    const result = await wrapApiCall(
      "updateAlerter",
      // @type-variance — Zod-inferred optional fields → SDK `_PartialAlerterConfig` (discriminated `endpoint` union).
      () =>
        komodo.client.write("UpdateAlerter", {
          id: alerterId,
          config: args.config as unknown as Types._PartialAlerterConfig,
        }),
    );
    const built = buildApplyResult("update", "alerter", alerterId, redactAlerter(result));
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(applyAlerterTool);

export const deleteAlerterTool = defineTool({
  name: "komodo_alerter_delete",
  description: "Unregister an Alerter from Komodo. Future alerts that would have been routed here are dropped.",
  input: z.object({
    alerter: alerterIdSchema.describe("Alerter id or name to delete"),
  }),
  output: deleteResultSchema,
  annotations: { destructiveHint: true },
  guardrail: "destructive",
  _meta: { category: ToolCategories.ALERTER },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("deleteAlerter", () => komodo.client.write("DeleteAlerter", { id: args.alerter }));
    const built = buildDeleteResult("alerter", args.alerter, redactAlerter(result));
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(deleteAlerterTool);
