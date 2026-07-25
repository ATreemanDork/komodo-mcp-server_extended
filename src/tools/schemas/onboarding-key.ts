/**
 * OnboardingKey Schemas
 *
 * Zod schemas for Komodo OnboardingKey resources (`komodo_onboarding_key_*`
 * tools). OnboardingKeys are pre-shared keys a Periphery agent presents to
 * Core to register (onboard) itself as a new Server.
 *
 * Genuinely new construction — `references/komodo-mcp-server` never built
 * this category, so there is no reference file to port from. Modeled on
 * `schemas/alerter.ts`'s summary/list/apply shape (the closest existing
 * simple-CRUD analog), with every field grounded directly in the
 * `komodo_client` `Types.OnboardingKey` / `Types.CreateOnboardingKey` /
 * `Types.UpdateOnboardingKey` interfaces (node_modules/komodo_client/dist/types.d.ts).
 *
 * Unlike every other domain here, the identifier for update/delete is the
 * literal `public_key` field — there is no generic "id or name" for this
 * resource (and no single-item Get endpoint, hence no `_info` tool).
 *
 * @module tools/schemas/onboarding-key
 */

import { z } from "zod";
import { resourceNameSchema } from "./validators.js";
import { pageOutputSchema } from "./shared.js";

/** OnboardingKey identifier accepted by the Komodo API — the literal `public_key` string, not an id/name. */
export const onboardingKeyIdSchema = z.string().min(1);

/** Compact summary of a single onboarding key (`Types.OnboardingKey`, minus nothing sensitive — it never carries a private key). */
export const onboardingKeySummarySchema = z.object({
  public_key: z.string().describe("Unique public key identifying this onboarding key"),
  name: z.string().optional().describe("Name associated with the key for management"),
  enabled: z.boolean().optional().describe("Whether the key is currently enabled"),
  expires: z
    .number()
    .int()
    .optional()
    .describe("Expiry as a unix timestamp in milliseconds, or 0 if the key never expires"),
  created_at: z.number().int().optional().describe("Unix timestamp (ms) of key creation"),
  onboarded: z.array(z.string()).optional().describe("Server IDs that have been onboarded using this key"),
  tags: z.array(z.string()).optional().describe("Default tags applied to Servers onboarded with this key"),
  privileged: z
    .boolean()
    .optional()
    .describe(
      "Whether this key may enable a disabled Server, remove a Server's address config " +
        "(allowing Periphery -> Core connection), or update an existing Server's public keys",
    ),
  copy_server: z.string().optional().describe("Server whose config is copied when initializing Servers via this key"),
  create_builder: z
    .boolean()
    .optional()
    .describe("Whether a Builder is also created for Servers onboarded via this key"),
});

/** Output of `komodo_onboarding_key_list`. */
export const onboardingKeyListOutputSchema = z
  .object({
    items: z.array(onboardingKeySummarySchema).describe("Onboarding keys registered in Komodo"),
    page: pageOutputSchema.optional(),
  })
  .describe("List of registered onboarding keys");

// ============================================================================
// Input Schema — CRUD
// ============================================================================

/**
 * Input for `komodo_onboarding_key_apply` (create-or-update).
 *
 * Flat schema (modeled on `alerterApplyInputSchema`) so MCP Inspector renders
 * the form. The handler enforces `name` for create and `public_key` for
 * update at runtime. `private_key` only applies to create (`Types.CreateOnboardingKey`);
 * `enabled` only applies to update (`Types.UpdateOnboardingKey`) — every other
 * field is accepted by both.
 */
export const onboardingKeyApplyInputSchema = z.object({
  action: z
    .enum(["create", "update"])
    .describe("'create' to register a new onboarding key, 'update' to PATCH an existing one"),
  name: resourceNameSchema
    .optional()
    .describe("Required when action='create' — unique name for the new key. Also updatable on action='update'."),
  public_key: onboardingKeyIdSchema
    .optional()
    .describe(
      "Required when action='update' — the existing key's literal `public_key` string. " +
        "This resource has no generic id/name lookup; `public_key` IS the identifier.",
    ),
  enabled: z.boolean().optional().describe("action='update' only — enable or disable the key"),
  expires: z
    .number()
    .int()
    .optional()
    .describe("Unix timestamp (ms) when the key expires. 0 (default) means the key never expires."),
  tags: z.array(z.string()).optional().describe("Default tags to apply to Servers onboarded with this key"),
  privileged: z
    .boolean()
    .optional()
    .describe(
      "Allow this key to: 1) enable a disabled Server, 2) remove a Server's address config " +
        "(allowing Periphery -> Core connection), 3) update an existing Server's public keys",
    ),
  copy_server: z
    .string()
    .optional()
    .describe("Existing Server whose config to copy when initializing new Servers onboarded via this key"),
  create_builder: z.boolean().optional().describe("Also create a Builder for Servers onboarded via this key"),
  private_key: z
    .string()
    .optional()
    .describe(
      "action='create' only — optionally supply an existing pkcs8-encoded private key instead of generating a fresh one",
    ),
});
