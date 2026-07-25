/**
 * Action Renderers
 *
 * Markdown renderers for `komodo_action_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts,
 * `renderActionList`/`renderActionInfo`) — pulls its primitives
 * (`stateBadge`, `pageFooter`, `jsonBlock`, `PageInfo`) from
 * `./_shared.ts` instead of the reference's single monolithic file.
 *
 * @module tools/renderers/action
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { stateBadge, pageFooter, jsonBlock, type PageInfo } from "./_shared.js";

interface ActionListItem {
  readonly id: string;
  readonly name: string;
  readonly state?: string;
  readonly last_run_at?: number;
  readonly next_scheduled_run?: number;
  readonly schedule_error?: string;
}

export function renderActionList(payload: { items: readonly ActionListItem[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.ACTION} Actions (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo actions found.`;
  const rows = items
    .map((a) => {
      const sched = a.next_scheduled_run ? ` | next ${new Date(a.next_scheduled_run).toISOString()}` : "";
      const err = a.schedule_error ? ` | schedule_error: ${a.schedule_error}` : "";
      return `• ${a.name} (${a.id}) — ${stateBadge(a.state)}${sched}${err}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface ActionInfoPayload {
  readonly summary: { readonly id: string; readonly name: string };
  readonly info?: unknown;
  readonly resourceLink?: { readonly uri: string };
}

export function renderActionInfo(payload: ActionInfoPayload): string {
  const header = `${RESPONSE_ICONS.INFO} Action "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull Action resource available at: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${jsonBlock(payload.info)}`;
}
