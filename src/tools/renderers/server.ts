/**
 * Server Renderers
 *
 * Markdown renderers for `komodo_server_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts,
 * `renderServerList`/`renderServerInfo`/`renderServerStats`) — pulls its
 * primitives (`stateBadge`, `pageFooter`, `jsonBlock`, `PageInfo`) from
 * `./_shared.ts` instead of the reference's single monolithic file.
 *
 * @module tools/renderers/server
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { stateBadge, pageFooter, jsonBlock, type PageInfo } from "./_shared.js";

interface ServerListItem {
  readonly id: string;
  readonly name: string;
  readonly state?: string;
  readonly version?: string;
  readonly region?: string;
}

export function renderServerList(payload: { items: readonly ServerListItem[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.SERVER} Available servers (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo servers found.`;
  const rows = items
    .map((s) => {
      const version = s.version ?? "N/A";
      const region = s.region ? ` | Region: ${s.region}` : "";
      return `• ${s.name} (${s.id}) — Status: ${stateBadge(s.state)} | Version: ${version}${region}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface ServerInfoPayload {
  readonly summary: { readonly id: string; readonly name: string };
  readonly info?: unknown;
  readonly resourceLink?: { readonly uri: string };
}

export function renderServerInfo(payload: ServerInfoPayload): string {
  const header = `${RESPONSE_ICONS.INFO} Server "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull server resource available at: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${jsonBlock(payload.info)}`;
}

export function renderServerStats(payload: { server: string; status: string }): string {
  return `${RESPONSE_ICONS.SERVER} Server "${payload.server}" status\n\n• Status: ${stateBadge(payload.status)}`;
}
