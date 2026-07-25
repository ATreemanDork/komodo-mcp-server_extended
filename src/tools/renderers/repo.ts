/**
 * Repo Renderers
 *
 * Markdown renderers for `komodo_repo_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts,
 * `renderRepoList`/`renderRepoInfo`) — pulls its primitives (`stateBadge`,
 * `pageFooter`, `jsonBlock`, `PageInfo`) from `./_shared.ts` instead of the
 * reference's single monolithic file.
 *
 * @module tools/renderers/repo
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { stateBadge, pageFooter, jsonBlock, type PageInfo } from "./_shared.js";

interface RepoListItem {
  readonly id: string;
  readonly name: string;
  readonly state?: string;
  readonly server_id?: string;
  readonly builder_id?: string;
  readonly repo?: string;
  readonly branch?: string;
  readonly cloned_hash?: string;
  readonly built_hash?: string;
  readonly latest_hash?: string;
}

export function renderRepoList(payload: { items: readonly RepoListItem[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.REPO} Repos (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo repos found.`;
  const rows = items
    .map((r) => {
      const repo = r.repo ? ` | ${r.repo}${r.branch ? `@${r.branch}` : ""}` : "";
      const hashes: string[] = [];
      if (r.cloned_hash) hashes.push(`cloned ${r.cloned_hash}`);
      if (r.built_hash) hashes.push(`built ${r.built_hash}`);
      if (r.latest_hash) hashes.push(`latest ${r.latest_hash}`);
      const hashLine = hashes.length > 0 ? ` (${hashes.join(", ")})` : "";
      return `• ${r.name} (${r.id}) — ${stateBadge(r.state)}${repo}${hashLine}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface RepoInfoPayload {
  readonly summary: { readonly id: string; readonly name: string };
  readonly info?: unknown;
  readonly resourceLink?: { readonly uri: string };
}

export function renderRepoInfo(payload: RepoInfoPayload): string {
  const header = `${RESPONSE_ICONS.INFO} Repo "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull repo resource available at: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${jsonBlock(payload.info)}`;
}
