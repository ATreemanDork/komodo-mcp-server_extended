/**
 * Provider Schemas
 *
 * Zod schemas for Komodo's two credential-account resource types:
 * `GitProviderAccount` (`komodo_git_provider_*` tools) and
 * `DockerRegistryAccount` (`komodo_docker_registry_*` tools). Both are
 * small, symmetric "account" resources — credentials Repo/Build/Stack
 * resources reference by domain/username — so they share one schema file
 * and one tool category (`ToolCategories.PROVIDER`).
 *
 * Genuinely new construction, not a port — `references/komodo-mcp-server`
 * never built this category. Every field here is grounded in
 * `node_modules/komodo_client/dist/types.d.ts`:
 * - `Types.GitProviderAccount` (~L1212): `{ _id?, domain, https, username?, token? }`
 * - `Types.DockerRegistryAccount` (~L1184): `{ _id?, domain, username?, token? }` (no `https`)
 * - `Types.GitProvider` / `Types.DockerRegistry` (config-sourced, read-only,
 *   distinct from the DB-stored accounts above): `{ domain, https?, accounts: ProviderAccount[] }`
 * - `Types.ProviderAccount`: `{ username, token? }`
 *
 * Security: `token` is documented on `GitProviderAccount`/`DockerRegistryAccount`
 * as "the token in plain text on the db... insecure". Every *output* schema
 * here replaces it with a boolean `has_token` — the raw value is never
 * round-tripped back out. `token` only appears as an *input* field on the
 * `*_apply` schemas (the API requires it to set credentials).
 *
 * @module tools/schemas/provider
 */

import { z } from "zod";
import type { Types } from "komodo_client";
import { pageOutputSchema } from "./shared.js";

/** Git provider account identifier (Mongo ObjectId string). */
export const gitProviderAccountIdSchema = z.string().min(1);

/** Docker registry account identifier (Mongo ObjectId string). */
export const dockerRegistryAccountIdSchema = z.string().min(1);

/** `Types.ResourceTarget` — narrows a config-sourced provider list to one resource's config. */
export const resourceTargetSchema = z
  .object({
    type: z.string().describe("Resource type — 'Server', 'Builder', 'Stack', 'Deployment', 'Build', 'Repo', ..."),
    id: z.string().describe("Resource id or name"),
  })
  .describe("Komodo `ResourceTarget` — expands the config-sourced list with providers available on this resource");

// ============================================================================
// Git Provider Account
// ============================================================================

/** Redacted summary of a Git Provider Account — never carries the raw `token` value. */
export const gitProviderAccountSummarySchema = z.object({
  id: z.string().describe("Git provider account ID"),
  domain: z.string().describe("Git provider domain, no protocol (e.g. 'github.com')"),
  https: z.boolean().describe("Whether this account connects over https"),
  username: z.string().optional().describe("Account username"),
  has_token: z
    .boolean()
    .describe("Whether an access token is set on this account (the value itself is never returned)"),
});

/** Output of `komodo_git_provider_list`. */
export const gitProviderAccountListOutputSchema = z
  .object({
    items: z.array(gitProviderAccountSummarySchema).describe("Registered git provider accounts"),
    page: pageOutputSchema.optional(),
  })
  .describe("List of registered git provider accounts (tokens redacted)");

/** Output of `komodo_git_provider_info`. */
export const gitProviderAccountInfoOutputSchema = z
  .object({
    summary: gitProviderAccountSummarySchema,
  })
  .describe("Git provider account detail (token redacted)");

/** Input for `komodo_git_provider_apply` (create-or-update). */
export const gitProviderAccountApplyInputSchema = z.object({
  action: z
    .enum(["create", "update"])
    .describe("'create' to register a new account, 'update' to PATCH an existing one"),
  account: gitProviderAccountIdSchema
    .optional()
    .describe("Required when action='update' — existing git provider account id"),
  domain: z
    .string()
    .min(1)
    .optional()
    .describe("Provider domain, no protocol (e.g. 'github.com'). Required when action='create'."),
  https: z.boolean().optional().describe("Whether to connect over https. Default: true"),
  username: z.string().optional().describe("Account username"),
  token: z.string().optional().describe("Access token to store (write-only — never echoed back in any tool output)"),
});

/** A single account entry as returned within `ListGitProvidersFromConfig` (config-sourced, read-only). */
export const providerAccountConfigSchema = z.object({
  username: z.string().describe("Account username"),
  has_token: z.boolean().describe("Whether this config-sourced account has an access token set (value never returned)"),
});

export const gitProviderFromConfigSchema = z.object({
  domain: z.string().describe("Git provider domain"),
  https: z.boolean().describe("Whether this provider is accessed over https"),
  accounts: z.array(providerAccountConfigSchema).describe("Accounts configured for this provider"),
});

/** Output of `komodo_git_provider_list_from_config`. */
export const gitProvidersFromConfigOutputSchema = z
  .object({
    items: z.array(gitProviderFromConfigSchema).describe("Git providers available from Core/Periphery config"),
    page: pageOutputSchema.optional(),
  })
  .describe("Statically configured git providers (distinct from DB-stored accounts; tokens redacted)");

// ============================================================================
// Docker Registry Account
// ============================================================================

/** Redacted summary of a Docker Registry Account — never carries the raw `token` value. */
export const dockerRegistryAccountSummarySchema = z.object({
  id: z.string().describe("Docker registry account ID"),
  domain: z.string().describe("Docker registry domain (e.g. 'docker.io', 'ghcr.io')"),
  username: z.string().optional().describe("Account username"),
  has_token: z
    .boolean()
    .describe("Whether an access token is set on this account (the value itself is never returned)"),
});

/** Output of `komodo_docker_registry_list`. */
export const dockerRegistryAccountListOutputSchema = z
  .object({
    items: z.array(dockerRegistryAccountSummarySchema).describe("Registered Docker registry accounts"),
    page: pageOutputSchema.optional(),
  })
  .describe("List of registered Docker registry accounts (tokens redacted)");

/** Output of `komodo_docker_registry_info`. */
export const dockerRegistryAccountInfoOutputSchema = z
  .object({
    summary: dockerRegistryAccountSummarySchema,
  })
  .describe("Docker registry account detail (token redacted)");

/** Input for `komodo_docker_registry_apply` (create-or-update). */
export const dockerRegistryAccountApplyInputSchema = z.object({
  action: z
    .enum(["create", "update"])
    .describe("'create' to register a new account, 'update' to PATCH an existing one"),
  account: dockerRegistryAccountIdSchema
    .optional()
    .describe("Required when action='update' — existing docker registry account id"),
  domain: z
    .string()
    .min(1)
    .optional()
    .describe("Registry domain (e.g. 'docker.io', 'ghcr.io'). Required when action='create'."),
  username: z.string().optional().describe("Account username"),
  token: z.string().optional().describe("Access token to store (write-only — never echoed back in any tool output)"),
});

export const dockerRegistryFromConfigSchema = z.object({
  domain: z.string().describe("Docker registry domain"),
  accounts: z.array(providerAccountConfigSchema).describe("Accounts configured for this registry"),
  organizations: z
    .array(z.string())
    .optional()
    .describe("Organizations available on this registry, for pushing under an org namespace"),
});

/** Output of `komodo_docker_registry_list_from_config`. */
export const dockerRegistriesFromConfigOutputSchema = z
  .object({
    items: z.array(dockerRegistryFromConfigSchema).describe("Docker registries available from Core/Periphery config"),
    page: pageOutputSchema.optional(),
  })
  .describe("Statically configured docker registries (distinct from DB-stored accounts; tokens redacted)");

// ============================================================================
// Redaction helpers (shared by both tool files)
// ============================================================================

/** Map a full `GitProviderAccount` (raw `token` and all) to its redacted summary shape. */
export function toGitProviderAccountSummary(
  account: Types.GitProviderAccount,
  fallbackId?: string,
): z.infer<typeof gitProviderAccountSummarySchema> {
  return {
    id: account._id?.$oid ?? fallbackId ?? "",
    domain: account.domain,
    https: account.https,
    ...(account.username ? { username: account.username } : {}),
    has_token: Boolean(account.token),
  };
}

/** Map a full `DockerRegistryAccount` (raw `token` and all) to its redacted summary shape. */
export function toDockerRegistryAccountSummary(
  account: Types.DockerRegistryAccount,
  fallbackId?: string,
): z.infer<typeof dockerRegistryAccountSummarySchema> {
  return {
    id: account._id?.$oid ?? fallbackId ?? "",
    domain: account.domain,
    ...(account.username ? { username: account.username } : {}),
    has_token: Boolean(account.token),
  };
}

/** Map a `Types.ProviderAccount` (config-sourced, raw `token` and all) to its redacted shape. */
export function toProviderAccountConfig(account: Types.ProviderAccount): z.infer<typeof providerAccountConfigSchema> {
  return { username: account.username, has_token: Boolean(account.token) };
}
