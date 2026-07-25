/**
 * Docker Registry Account Tools
 *
 * Tools for managing Komodo `DockerRegistryAccount` resources — stored
 * credentials for private Docker image registries, referenced by
 * Build/Deployment/Stack resources' image-push/pull configuration.
 *
 * Tools (5):
 * - `komodo_docker_registry_list`             — list registered docker registry accounts
 * - `komodo_docker_registry_info`             — full account detail (token redacted)
 * - `komodo_docker_registry_apply`            — create-or-update (discriminated by `action`)
 * - `komodo_docker_registry_delete`           — remove an account
 * - `komodo_docker_registry_list_from_config` — statically configured registries from
 *   Core/Periphery config files (a distinct, read-only concept — not DB-stored accounts)
 *
 * No reference-repo file to port from — `references/komodo-mcp-server`
 * never built this category. Symmetric with `tools/git-provider.ts`
 * (same 5-tool CRUD + list-from-config shape); the only structural
 * difference is `DockerRegistryAccount` has no `https` field.
 *
 * Security: `DockerRegistryAccount.token` is documented upstream as "the
 * token in plain text on the db... insecure". Every handler below redacts
 * it to a `has_token` boolean before building any response — see
 * `schemas/provider.ts`'s `toDockerRegistryAccountSummary`/`toProviderAccountConfig`.
 * The raw value only appears as *input* on the apply tool (required to set
 * credentials) and is never read back out of a Komodo API response.
 *
 * @module tools/docker-registry
 */

import { z } from "zod";
import type { Types } from "komodo_client";
import { defineTool } from "../mcp/define-tool.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { ToolCategories, ToolScopes } from "../config/index.js";
import { AppErrorFactory } from "../errors/index.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { paginate } from "../utils/pagination.js";
import { buildApplyResult, buildDeleteResult } from "../utils/response-formatter.js";
import {
  renderDockerRegistryAccountList,
  renderDockerRegistryAccountInfo,
  renderDockerRegistriesFromConfig,
} from "./renderers/provider.js";
import {
  dockerRegistryAccountIdSchema,
  dockerRegistryAccountListOutputSchema,
  dockerRegistryAccountInfoOutputSchema,
  dockerRegistryAccountApplyInputSchema,
  dockerRegistriesFromConfigOutputSchema,
  resourceTargetSchema,
  toDockerRegistryAccountSummary,
  toProviderAccountConfig,
} from "./schemas/provider.js";
import { applyResultSchema, deleteResultSchema, paginationInputSchema } from "./schemas/shared.js";

// ============================================================================
// List
// ============================================================================

export const listDockerRegistryAccountsTool = defineTool({
  name: "komodo_docker_registry_list",
  description:
    "List Docker Registry Accounts registered in Komodo (stored credentials for private image registries, used by Build/Deployment/Stack image push/pull). Access tokens are never returned — only a `has_token` flag.",
  input: paginationInputSchema,
  output: dockerRegistryAccountListOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.PROVIDER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const accounts = await wrapApiCall("listDockerRegistryAccounts", () =>
      komodo.client.read("ListDockerRegistryAccounts", {}),
    );
    const allItems = accounts.map((a: Types.DockerRegistryAccount) => toDockerRegistryAccountSummary(a));
    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderDockerRegistryAccountList(payload) });
  },
});

registerToolDefinition(listDockerRegistryAccountsTool);

// ============================================================================
// Info
// ============================================================================

export const getDockerRegistryAccountInfoTool = defineTool({
  name: "komodo_docker_registry_info",
  description:
    "Get a single Docker Registry Account's detail (domain, username). The access token value is never returned — only a `has_token` flag.",
  input: z.object({
    account: dockerRegistryAccountIdSchema.describe("Docker registry account id"),
  }),
  output: dockerRegistryAccountInfoOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.PROVIDER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("getDockerRegistryAccount", () =>
      komodo.client.read("GetDockerRegistryAccount", { id: args.account }),
    );
    const summary = toDockerRegistryAccountSummary(result, args.account);
    const payload = { summary };
    return structuredResult(payload, { text: renderDockerRegistryAccountInfo(payload) });
  },
});

registerToolDefinition(getDockerRegistryAccountInfoTool);

// ============================================================================
// CRUD
// ============================================================================

export const applyDockerRegistryAccountTool = defineTool({
  name: "komodo_docker_registry_apply",
  description: [
    "Create or update a Komodo Docker Registry Account (PATCH-style). These store credentials for private Docker image registries, used for image push/pull by Build/Deployment/Stack resources.",
    'action="create": new account. Required: `domain`. Optional: `username`, `token`.',
    'action="update": existing account (`account` required). Only provided fields change.',
    "The `token` value is write-only — it is never echoed back in the tool response (only a `has_token` flag).",
  ].join("\n"),
  input: dockerRegistryAccountApplyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.PROVIDER },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "create") {
      if (!args.domain) throw AppErrorFactory.validation.fieldRequired("domain");
      const account: Types._PartialDockerRegistryAccount = {
        domain: args.domain,
        ...(args.username !== undefined ? { username: args.username } : {}),
        ...(args.token !== undefined ? { token: args.token } : {}),
      };
      const result = await wrapApiCall("createDockerRegistryAccount", () =>
        komodo.client.write("CreateDockerRegistryAccount", { account }),
      );
      const summary = toDockerRegistryAccountSummary(result);
      const built = buildApplyResult("create", "docker_registry_account", summary.id || args.domain, summary);
      return structuredResult(built.payload, { text: built.text });
    }
    if (!args.account) throw AppErrorFactory.validation.fieldRequired("account");
    const accountId = args.account;
    const account: Types._PartialDockerRegistryAccount = {
      ...(args.domain !== undefined ? { domain: args.domain } : {}),
      ...(args.username !== undefined ? { username: args.username } : {}),
      ...(args.token !== undefined ? { token: args.token } : {}),
    };
    const result = await wrapApiCall("updateDockerRegistryAccount", () =>
      komodo.client.write("UpdateDockerRegistryAccount", { id: accountId, account }),
    );
    const summary = toDockerRegistryAccountSummary(result, accountId);
    const built = buildApplyResult("update", "docker_registry_account", accountId, summary);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(applyDockerRegistryAccountTool);

export const deleteDockerRegistryAccountTool = defineTool({
  name: "komodo_docker_registry_delete",
  description:
    "Delete a Docker Registry Account from Komodo. Resources referencing it for image push/pull will fail to authenticate on next use.",
  input: z.object({
    account: dockerRegistryAccountIdSchema.describe("Docker registry account id to delete"),
  }),
  output: deleteResultSchema,
  annotations: { destructiveHint: true },
  guardrail: "destructive",
  _meta: { category: ToolCategories.PROVIDER },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("deleteDockerRegistryAccount", () =>
      komodo.client.write("DeleteDockerRegistryAccount", { id: args.account }),
    );
    const summary = toDockerRegistryAccountSummary(result, args.account);
    const built = buildDeleteResult("docker_registry_account", args.account, summary);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(deleteDockerRegistryAccountTool);

// ============================================================================
// List from config (distinct, read-only concept)
// ============================================================================

export const listDockerRegistriesFromConfigTool = defineTool({
  name: "komodo_docker_registry_list_from_config",
  description:
    "List docker registries statically configured in Core/Periphery config files (core config, plus registries configured on builds/deployments and — when `target` is given — on that specific Server or Builder). Distinct from `komodo_docker_registry_list`, which lists DB-stored accounts. Access tokens are never returned — only a `has_token` flag per account.",
  input: z
    .object({
      target: resourceTargetSchema.optional().describe("Optional Server or Builder target to expand the list with"),
    })
    .merge(paginationInputSchema),
  output: dockerRegistriesFromConfigOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.PROVIDER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const registries = await wrapApiCall("listDockerRegistriesFromConfig", () =>
      komodo.client.read("ListDockerRegistriesFromConfig", {
        ...(args.target ? { target: args.target as Types.ResourceTarget } : {}),
      }),
    );
    const allItems = registries.map((r: Types.DockerRegistry) => ({
      domain: r.domain,
      accounts: r.accounts.map((a: Types.ProviderAccount) => toProviderAccountConfig(a)),
      ...(r.organizations ? { organizations: r.organizations } : {}),
    }));
    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderDockerRegistriesFromConfig(payload) });
  },
});

registerToolDefinition(listDockerRegistriesFromConfigTool);
