/**
 * Alerter Renderers
 *
 * Markdown renderers for `komodo_alerter_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts,
 * `renderAlerterList`/`renderAlerterInfo`) — pulls its primitives
 * (`pageFooter`, `jsonBlock`, `PageInfo`) from `./_shared.ts` instead of the
 * reference's single monolithic file.
 *
 * @module tools/renderers/alerter
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { pageFooter, jsonBlock, type PageInfo } from "./_shared.js";

interface AlerterListItem {
  readonly id: string;
  readonly name: string;
  readonly enabled?: boolean;
  readonly endpoint_type?: string;
}

export function renderAlerterList(payload: { items: readonly AlerterListItem[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.ALERTER} Alerters (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo alerters configured.`;
  const rows = items
    .map((a) => {
      const enabled = a.enabled === undefined ? "" : a.enabled ? " | enabled" : " | disabled";
      const ep = a.endpoint_type ? ` | ${a.endpoint_type}` : "";
      return `• ${a.name} (${a.id})${ep}${enabled}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface AlerterInfoPayload {
  readonly summary: { readonly id: string; readonly name: string };
  readonly info?: unknown;
  readonly resourceLink?: { readonly uri: string };
}

export function renderAlerterInfo(payload: AlerterInfoPayload): string {
  const header = `${RESPONSE_ICONS.INFO} Alerter "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull alerter resource available at: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${jsonBlock(payload.info)}`;
}
