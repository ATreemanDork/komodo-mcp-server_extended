/**
 * Provider Renderers
 *
 * Markdown renderers for `komodo_git_provider_*` and `komodo_docker_registry_*`
 * tool responses. No reference-repo file to port from — this category is new
 * construction. Modeled on `renderers/alerter.ts`'s list/info split, the
 * closest existing analog (small credential-bearing resource, no
 * resource-link offloading).
 *
 * Every renderer here operates on already-redacted payloads (`has_token`
 * booleans, never raw `token` values) — see `schemas/provider.ts` for where
 * that redaction happens.
 *
 * @module tools/renderers/provider
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { pageFooter, type PageInfo } from "./_shared.js";

// ============================================================================
// Git Provider Account
// ============================================================================

interface GitProviderAccountSummary {
  readonly id: string;
  readonly domain: string;
  readonly https: boolean;
  readonly username?: string | undefined;
  readonly has_token: boolean;
}

export function renderGitProviderAccountList(payload: {
  items: readonly GitProviderAccountSummary[];
  page?: PageInfo;
}): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.PROVIDER} Git provider accounts (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo git provider accounts registered.`;
  const rows = items
    .map((a) => {
      const proto = a.https ? "https" : "http";
      const user = a.username ? ` | ${a.username}` : "";
      const token = a.has_token ? " | token set" : " | no token";
      return `• ${a.domain} (${proto}, ${a.id})${user}${token}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

export function renderGitProviderAccountInfo(payload: { summary: GitProviderAccountSummary }): string {
  const { summary } = payload;
  const proto = summary.https ? "https" : "http";
  const lines = [
    `ID: ${summary.id}`,
    `Domain: ${summary.domain} (${proto})`,
    ...(summary.username ? [`Username: ${summary.username}`] : []),
    `Token: ${summary.has_token ? "set (value redacted)" : "not set"}`,
  ];
  return `${RESPONSE_ICONS.INFO} Git provider account "${summary.domain}"\n\n${lines.join("\n")}`;
}

interface GitProviderFromConfig {
  readonly domain: string;
  readonly https: boolean;
  readonly accounts: readonly { readonly username: string; readonly has_token: boolean }[];
}

export function renderGitProvidersFromConfig(payload: {
  items: readonly GitProviderFromConfig[];
  page?: PageInfo;
}): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.PROVIDER} Git providers from config (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo git providers configured.`;
  const rows = items
    .map((p) => {
      const proto = p.https ? "https" : "http";
      const accounts =
        p.accounts.length === 0
          ? "no accounts"
          : p.accounts.map((a) => `${a.username}${a.has_token ? " (token set)" : " (no token)"}`).join(", ");
      return `• ${p.domain} (${proto}) — ${accounts}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

// ============================================================================
// Docker Registry Account
// ============================================================================

interface DockerRegistryAccountSummary {
  readonly id: string;
  readonly domain: string;
  readonly username?: string | undefined;
  readonly has_token: boolean;
}

export function renderDockerRegistryAccountList(payload: {
  items: readonly DockerRegistryAccountSummary[];
  page?: PageInfo;
}): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.PROVIDER} Docker registry accounts (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo docker registry accounts registered.`;
  const rows = items
    .map((a) => {
      const user = a.username ? ` | ${a.username}` : "";
      const token = a.has_token ? " | token set" : " | no token";
      return `• ${a.domain} (${a.id})${user}${token}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

export function renderDockerRegistryAccountInfo(payload: { summary: DockerRegistryAccountSummary }): string {
  const { summary } = payload;
  const lines = [
    `ID: ${summary.id}`,
    `Domain: ${summary.domain}`,
    ...(summary.username ? [`Username: ${summary.username}`] : []),
    `Token: ${summary.has_token ? "set (value redacted)" : "not set"}`,
  ];
  return `${RESPONSE_ICONS.INFO} Docker registry account "${summary.domain}"\n\n${lines.join("\n")}`;
}

interface DockerRegistryFromConfig {
  readonly domain: string;
  readonly accounts: readonly { readonly username: string; readonly has_token: boolean }[];
  readonly organizations?: readonly string[] | undefined;
}

export function renderDockerRegistriesFromConfig(payload: {
  items: readonly DockerRegistryFromConfig[];
  page?: PageInfo;
}): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.PROVIDER} Docker registries from config (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo docker registries configured.`;
  const rows = items
    .map((r) => {
      const accounts =
        r.accounts.length === 0
          ? "no accounts"
          : r.accounts.map((a) => `${a.username}${a.has_token ? " (token set)" : " (no token)"}`).join(", ");
      const orgs = r.organizations && r.organizations.length > 0 ? ` | orgs: ${r.organizations.join(", ")}` : "";
      return `• ${r.domain} — ${accounts}${orgs}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}
