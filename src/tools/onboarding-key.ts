/**
 * OnboardingKey Tools
 *
 * Tools for managing Komodo OnboardingKey resources — pre-shared keys a
 * Periphery agent presents to Core to register (onboard) itself as a new
 * Server.
 *
 * Tools (3):
 * - `komodo_onboarding_key_list`   — list registered onboarding keys
 * - `komodo_onboarding_key_apply`  — create-or-update (discriminated by `action`)
 * - `komodo_onboarding_key_delete` — unregister an onboarding key
 *
 * Genuinely new construction — `references/komodo-mcp-server` never built
 * this category, so there is no reference file to port from. Modeled
 * directly on `tools/alerter.ts`'s list/apply/delete pattern (the closest
 * existing simple-CRUD analog), using the generic `applyResultSchema` /
 * `deleteResultSchema` output schemas and `buildApplyResult` /
 * `buildDeleteResult` helpers from `utils/response-formatter.ts`.
 *
 * There is no single-item Get endpoint for this resource in `komodo_client`
 * (no `GetOnboardingKey` read), so unlike every other domain there is no
 * `komodo_onboarding_key_info` tool.
 *
 * Unlike every other domain here, the identifier for update/delete is the
 * literal `public_key` string field (`Types.UpdateOnboardingKey.public_key`,
 * `Types.DeleteOnboardingKey.public_key`) — not a generic resource id/name.
 *
 * @module tools/onboarding-key
 */

import { Types } from "komodo_client";
import { z } from "zod";
import { defineTool } from "../mcp/define-tool.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { ToolCategories, ToolScopes } from "../config/index.js";
import { GuardrailTiers } from "../guardrails/policy.js";
import { AppErrorFactory } from "../errors/index.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { paginate } from "../utils/pagination.js";
import { buildApplyResult, buildDeleteResult } from "../utils/response-formatter.js";
import { renderOnboardingKeyList } from "./renderers/onboarding-key.js";
import {
  onboardingKeyIdSchema,
  onboardingKeyListOutputSchema,
  onboardingKeyApplyInputSchema,
} from "./schemas/onboarding-key.js";
import { applyResultSchema, deleteResultSchema, paginationInputSchema } from "./schemas/shared.js";

type OnboardingKey = Types.OnboardingKey;

// ============================================================================
// List
// ============================================================================

export const listOnboardingKeysTool = defineTool({
  name: "komodo_onboarding_key_list",
  description:
    "List all onboarding keys registered in Komodo. Onboarding keys are pre-shared keys a Periphery agent " +
    "presents to Core to register (onboard) itself as a new Server. There is no single-item Get for this " +
    "resource — use this list to look up a key's `public_key` before update/delete.",
  input: paginationInputSchema,
  output: onboardingKeyListOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.ONBOARDING_KEY },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const keys = await wrapApiCall("listOnboardingKeys", () => komodo.client.read("ListOnboardingKeys", {}));

    const allItems = keys.map((k: OnboardingKey) => ({
      public_key: k.public_key,
      ...(k.name !== undefined && { name: k.name }),
      ...(k.enabled !== undefined && { enabled: k.enabled }),
      ...(k.expires !== undefined && { expires: k.expires }),
      ...(k.created_at !== undefined && { created_at: k.created_at }),
      ...(k.onboarded !== undefined && { onboarded: k.onboarded }),
      ...(k.tags !== undefined && { tags: k.tags }),
      ...(k.privileged !== undefined && { privileged: k.privileged }),
      ...(k.copy_server !== undefined && { copy_server: k.copy_server }),
      ...(k.create_builder !== undefined && { create_builder: k.create_builder }),
    }));

    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderOnboardingKeyList(payload) });
  },
});

registerToolDefinition(listOnboardingKeysTool);

// ============================================================================
// CRUD
// ============================================================================

export const applyOnboardingKeyTool = defineTool({
  name: "komodo_onboarding_key_apply",
  description: [
    "Create or update a Komodo OnboardingKey (PATCH-style). Onboarding keys let a Periphery agent " +
      "register itself as a new Server by presenting the key.",
    'action="create": new key. Required: name. Response includes a one-time `private_key` — it is ' +
      "generated fresh (or taken from `private_key` if you supplied one) and cannot be retrieved again.",
    'action="update": existing key. Required: `public_key` (the literal public key string — this ' +
      "resource has no generic id/name lookup, unlike every other domain here). Only fields you set change.",
  ].join("\n"),
  input: onboardingKeyApplyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  // Gated at the critical tier on: (a) every `create` — it mints and returns a
  // one-time `private_key` that transits the model/gateway channel (issue
  // #160), a value-reveal we protect by confirm-gating rather than redacting
  // (the key IS the deliverable); and (b) any `update` that sets
  // privileged:true — a privileged key grants the redeeming Periphery agent
  // elevated powers later (enable disabled servers, rewrite server address
  // config / public keys). Plain non-privileged updates stay ungated.
  guardrail: (args) => (args.action === "create" || args.privileged === true ? GuardrailTiers.CRITICAL : undefined),
  _meta: { category: ToolCategories.ONBOARDING_KEY },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "create") {
      if (!args.name) throw AppErrorFactory.validation.fieldRequired("name");
      const name = args.name;
      const result = await wrapApiCall("createOnboardingKey", () =>
        komodo.client.write("CreateOnboardingKey", {
          name,
          ...(args.expires !== undefined && { expires: args.expires }),
          ...(args.private_key !== undefined && { private_key: args.private_key }),
          ...(args.tags !== undefined && { tags: args.tags }),
          ...(args.privileged !== undefined && { privileged: args.privileged }),
          ...(args.copy_server !== undefined && { copy_server: args.copy_server }),
          ...(args.create_builder !== undefined && { create_builder: args.create_builder }),
        }),
      );
      // `result` is `{ private_key, created }`. The one-time `private_key` is
      // the deliverable of this (now confirm-gated) call, so surface it
      // deliberately — the rest of the created resource still routes through
      // the redacting builder in case it ever carries other sensitive fields.
      const built = buildApplyResult("create", "onboarding_key", name, result.created);
      // Preserve the documented `resource.created` nesting (the API response
      // shape) and surface the one-time `private_key` alongside it.
      const payload = {
        ...built.payload,
        resource: { created: built.payload.resource, private_key: result.private_key },
      };
      const text =
        `${built.text}\n\n🔑 **private_key** (one-time — store it now, it cannot be retrieved again):\n` +
        `\`\`\`\n${result.private_key}\n\`\`\``;
      return structuredResult(payload, { text });
    }
    if (!args.public_key) throw AppErrorFactory.validation.fieldRequired("public_key");
    const publicKey = args.public_key;
    const result = await wrapApiCall("updateOnboardingKey", () =>
      komodo.client.write("UpdateOnboardingKey", {
        public_key: publicKey,
        ...(args.enabled !== undefined && { enabled: args.enabled }),
        ...(args.name !== undefined && { name: args.name }),
        ...(args.expires !== undefined && { expires: args.expires }),
        ...(args.tags !== undefined && { tags: args.tags }),
        ...(args.privileged !== undefined && { privileged: args.privileged }),
        ...(args.copy_server !== undefined && { copy_server: args.copy_server }),
        ...(args.create_builder !== undefined && { create_builder: args.create_builder }),
      }),
    );
    const built = buildApplyResult("update", "onboarding_key", publicKey, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(applyOnboardingKeyTool);

export const deleteOnboardingKeyTool = defineTool({
  name: "komodo_onboarding_key_delete",
  description:
    "Delete a Komodo OnboardingKey, identified by its literal `public_key` string (not a generic id/name). " +
    "Periphery agents presenting this key can no longer onboard as a Server afterward.",
  input: z.object({
    public_key: onboardingKeyIdSchema.describe("The onboarding key's `public_key` string to delete"),
  }),
  output: deleteResultSchema,
  annotations: { destructiveHint: true },
  guardrail: "destructive",
  _meta: { category: ToolCategories.ONBOARDING_KEY },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("deleteOnboardingKey", () =>
      komodo.client.write("DeleteOnboardingKey", { public_key: args.public_key }),
    );
    const built = buildDeleteResult("onboarding_key", args.public_key, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(deleteOnboardingKeyTool);
