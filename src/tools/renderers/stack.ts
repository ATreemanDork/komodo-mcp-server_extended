/**
 * Stack Renderers
 *
 * Markdown renderers for `komodo_stack_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts,
 * `renderStackList`/`renderStackInfo`) — pulls its primitives
 * (`stateBadge`, `pageFooter`, `jsonBlock`, `PageInfo`) from
 * `./_shared.ts` instead of the reference's single monolithic file.
 *
 * @module tools/renderers/stack
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { stateBadge, pageFooter, jsonBlock, type PageInfo } from "./_shared.js";

interface StackListItem {
  readonly id: string;
  readonly name: string;
  readonly state?: string;
  readonly server_id?: string;
}

export function renderStackList(payload: { items: readonly StackListItem[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.STACK} Stacks (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo stacks found.`;
  const rows = items
    .map((s) => {
      const server = s.server_id ? ` | Server: ${s.server_id}` : "";
      return `• ${s.name} (${s.id}) — State: ${stateBadge(s.state)}${server}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface StackInfoPayload {
  readonly summary: { readonly id: string; readonly name: string };
  readonly info?: unknown;
  readonly resourceLink?: { readonly uri: string };
}

export function renderStackInfo(payload: StackInfoPayload): string {
  const header = `${RESPONSE_ICONS.INFO} Stack "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull stack resource available at: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${jsonBlock(payload.info)}`;
}
