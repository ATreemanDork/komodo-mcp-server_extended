/**
 * Resource Sync Renderers
 *
 * Markdown renderers for `komodo_resource_sync_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts,
 * `renderResourceSyncList`/`renderResourceSyncInfo`) — pulls its primitives
 * (`stateBadge`, `pageFooter`, `jsonBlock`, `PageInfo`) from `./_shared.ts`
 * instead of the reference's single monolithic file.
 *
 * @module tools/renderers/resource-sync
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { stateBadge, pageFooter, jsonBlock, type PageInfo } from "./_shared.js";

interface ResourceSyncListItemRender {
  readonly id: string;
  readonly name: string;
  readonly state?: string;
  readonly managed?: boolean;
  readonly repo?: string;
  readonly branch?: string;
  readonly resource_path?: readonly string[];
  readonly last_sync_ts?: number;
  readonly last_sync_hash?: string;
}

export function renderResourceSyncList(payload: {
  items: readonly ResourceSyncListItemRender[];
  page?: PageInfo;
}): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.SYNC} Resource Syncs (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo resource syncs registered.`;
  const rows = items
    .map((s) => {
      const repo = s.repo ? ` | ${s.repo}${s.branch ? `@${s.branch}` : ""}` : "";
      const managed = s.managed ? " | managed" : "";
      const hash = s.last_sync_hash ? ` | last ${s.last_sync_hash}` : "";
      return `• ${s.name} (${s.id}) — ${stateBadge(s.state)}${managed}${repo}${hash}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface ResourceSyncInfoPayload {
  readonly summary: { readonly id: string; readonly name: string };
  readonly info?: unknown;
  readonly resourceLink?: { readonly uri: string };
}

export function renderResourceSyncInfo(payload: ResourceSyncInfoPayload): string {
  const header = `${RESPONSE_ICONS.SYNC} Resource Sync "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull resource sync payload available at: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${jsonBlock(payload.info)}`;
}
