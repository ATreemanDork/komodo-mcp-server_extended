/**
 * Git Provider Account Tools
 *
 * Tools for managing Komodo `GitProviderAccount` resources — stored
 * credentials for private git hosts, referenced by Repo/Build/Stack
 * resources' `git_account` field.
 *
 * Tools (5):
 * - `komodo_git_provider_list`             — list registered git provider accounts
 * - `komodo_git_provider_info`              — full account detail (token redacted)
 * - `komodo_git_provider_apply`             — create-or-update (discriminated by `action`)
 * - `komodo_git_provider_delete`            — remove an account
 * - `komodo_git_provider_list_from_config`  — statically configured providers from
 *   Core/Periphery config files (a distinct, read-only concept — not DB-stored accounts)
 *
 * No reference-repo file to port from — `references/komodo-mcp-server`
 * never built this category. Modeled on `tools/alerter.ts`'s CRUD pattern
 * (the closest existing analog: small resource, generic apply/delete result
 * envelopes, no resource-link offloading).
 *
 * Security: `GitProviderAccount.token` is documented upstream as "the token
 * in plain text on the db... insecure". Every handler below redacts it to a
 * `has_token` boolean before building any response — see
 * `schemas/provider.ts`'s `toGitProviderAccountSummary`/`toProviderAccountConfig`.
 * The raw value only appears as *input* on the apply tool (required to set
 * credentials) and is never read back out of a Komodo API response.
 *
 * @module tools/git-provider
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
  renderGitProviderAccountList,
  renderGitProviderAccountInfo,
  renderGitProvidersFromConfig,
} from "./renderers/provider.js";
import {
  gitProviderAccountIdSchema,
  gitProviderAccountListOutputSchema,
  gitProviderAccountInfoOutputSchema,
  gitProviderAccountApplyInputSchema,
  gitProvidersFromConfigOutputSchema,
  resourceTargetSchema,
  toGitProviderAccountSummary,
  toProviderAccountConfig,
} from "./schemas/provider.js";
import { applyResultSchema, deleteResultSchema, paginationInputSchema } from "./schemas/shared.js";

// ============================================================================
// List
// ============================================================================

export const listGitProviderAccountsTool = defineTool({
  name: "komodo_git_provider_list",
  description:
    "List Git Provider Accounts registered in Komodo (stored credentials for private git hosts, used by Repo/Build/Stack resources' `git_account` field). Access tokens are never returned — only a `has_token` flag.",
  input: paginationInputSchema,
  output: gitProviderAccountListOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.PROVIDER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const accounts = await wrapApiCall("listGitProviderAccounts", () =>
      komodo.client.read("ListGitProviderAccounts", {}),
    );
    const allItems = accounts.map((a: Types.GitProviderAccount) => toGitProviderAccountSummary(a));
    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderGitProviderAccountList(payload) });
  },
});

registerToolDefinition(listGitProviderAccountsTool);

// ============================================================================
// Info
// ============================================================================

export const getGitProviderAccountInfoTool = defineTool({
  name: "komodo_git_provider_info",
  description:
    "Get a single Git Provider Account's detail (domain, https, username). The access token value is never returned — only a `has_token` flag.",
  input: z.object({
    account: gitProviderAccountIdSchema.describe("Git provider account id"),
  }),
  output: gitProviderAccountInfoOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.PROVIDER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("getGitProviderAccount", () =>
      komodo.client.read("GetGitProviderAccount", { id: args.account }),
    );
    const summary = toGitProviderAccountSummary(result, args.account);
    const payload = { summary };
    return structuredResult(payload, { text: renderGitProviderAccountInfo(payload) });
  },
});

registerToolDefinition(getGitProviderAccountInfoTool);

// ============================================================================
// CRUD
// ============================================================================

export const applyGitProviderAccountTool = defineTool({
  name: "komodo_git_provider_apply",
  description: [
    "Create or update a Komodo Git Provider Account (PATCH-style). These store credentials for private git hosts, referenced by Repo/Build/Stack resources' `git_account` field.",
    'action="create": new account. Required: `domain`. Optional: `https` (default true), `username`, `token`.',
    'action="update": existing account (`account` required). Only provided fields change.',
    "The `token` value is write-only — it is never echoed back in the tool response (only a `has_token` flag).",
  ].join("\n"),
  input: gitProviderAccountApplyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.PROVIDER },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "create") {
      if (!args.domain) throw AppErrorFactory.validation.fieldRequired("domain");
      const account: Types._PartialGitProviderAccount = {
        domain: args.domain,
        ...(args.https !== undefined ? { https: args.https } : {}),
        ...(args.username !== undefined ? { username: args.username } : {}),
        ...(args.token !== undefined ? { token: args.token } : {}),
      };
      const result = await wrapApiCall("createGitProviderAccount", () =>
        komodo.client.write("CreateGitProviderAccount", { account }),
      );
      const summary = toGitProviderAccountSummary(result);
      const built = buildApplyResult("create", "git_provider_account", summary.id || args.domain, summary);
      return structuredResult(built.payload, { text: built.text });
    }
    if (!args.account) throw AppErrorFactory.validation.fieldRequired("account");
    const accountId = args.account;
    const account: Types._PartialGitProviderAccount = {
      ...(args.domain !== undefined ? { domain: args.domain } : {}),
      ...(args.https !== undefined ? { https: args.https } : {}),
      ...(args.username !== undefined ? { username: args.username } : {}),
      ...(args.token !== undefined ? { token: args.token } : {}),
    };
    const result = await wrapApiCall("updateGitProviderAccount", () =>
      komodo.client.write("UpdateGitProviderAccount", { id: accountId, account }),
    );
    const summary = toGitProviderAccountSummary(result, accountId);
    const built = buildApplyResult("update", "git_provider_account", accountId, summary);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(applyGitProviderAccountTool);

export const deleteGitProviderAccountTool = defineTool({
  name: "komodo_git_provider_delete",
  description:
    "Delete a Git Provider Account from Komodo. Resources referencing it by `git_account` will fail to authenticate on next use.",
  input: z.object({
    account: gitProviderAccountIdSchema.describe("Git provider account id to delete"),
  }),
  output: deleteResultSchema,
  annotations: { destructiveHint: true },
  guardrail: "destructive",
  _meta: { category: ToolCategories.PROVIDER },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("deleteGitProviderAccount", () =>
      komodo.client.write("DeleteGitProviderAccount", { id: args.account }),
    );
    const summary = toGitProviderAccountSummary(result, args.account);
    const built = buildDeleteResult("git_provider_account", args.account, summary);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(deleteGitProviderAccountTool);

// ============================================================================
// List from config (distinct, read-only concept)
// ============================================================================

export const listGitProvidersFromConfigTool = defineTool({
  name: "komodo_git_provider_list_from_config",
  description:
    "List git providers statically configured in Core/Periphery config files (core config, plus providers configured on builds/repos/syncs and — when `target` is given — on that specific Server or Builder). Distinct from `komodo_git_provider_list`, which lists DB-stored accounts. Access tokens are never returned — only a `has_token` flag per account.",
  input: z
    .object({
      target: resourceTargetSchema.optional().describe("Optional Server or Builder target to expand the list with"),
    })
    .merge(paginationInputSchema),
  output: gitProvidersFromConfigOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.PROVIDER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const providers = await wrapApiCall("listGitProvidersFromConfig", () =>
      komodo.client.read("ListGitProvidersFromConfig", {
        ...(args.target ? { target: args.target as Types.ResourceTarget } : {}),
      }),
    );
    const allItems = providers.map((p: Types.GitProvider) => ({
      domain: p.domain,
      https: p.https,
      accounts: p.accounts.map((a: Types.ProviderAccount) => toProviderAccountConfig(a)),
    }));
    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderGitProvidersFromConfig(payload) });
  },
});

registerToolDefinition(listGitProvidersFromConfigTool);
