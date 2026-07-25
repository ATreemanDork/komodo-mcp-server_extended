/**
 * Procedure Renderers
 *
 * Markdown renderers for `komodo_procedure_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts,
 * `renderProcedureList`/`renderProcedureInfo`) — pulls its primitives
 * (`stateBadge`, `pageFooter`, `jsonBlock`, `PageInfo`) from
 * `./_shared.ts` instead of the reference's single monolithic file.
 *
 * @module tools/renderers/procedure
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { stateBadge, pageFooter, jsonBlock, type PageInfo } from "./_shared.js";

interface ProcedureListItem {
  readonly id: string;
  readonly name: string;
  readonly state?: string;
  readonly stages?: number;
  readonly last_run_at?: number;
  readonly next_scheduled_run?: number;
  readonly schedule_error?: string;
}

export function renderProcedureList(payload: { items: readonly ProcedureListItem[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.PROCEDURE} Procedures (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo procedures found.`;
  const rows = items
    .map((p) => {
      const stages = p.stages !== undefined ? ` | ${String(p.stages)} stage${p.stages === 1 ? "" : "s"}` : "";
      const sched = p.next_scheduled_run ? ` | next ${new Date(p.next_scheduled_run).toISOString()}` : "";
      const err = p.schedule_error ? ` | schedule_error: ${p.schedule_error}` : "";
      return `• ${p.name} (${p.id}) — ${stateBadge(p.state)}${stages}${sched}${err}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface ProcedureInfoPayload {
  readonly summary: { readonly id: string; readonly name: string };
  readonly info?: unknown;
  readonly resourceLink?: { readonly uri: string };
}

export function renderProcedureInfo(payload: ProcedureInfoPayload): string {
  const header = `${RESPONSE_ICONS.INFO} Procedure "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull procedure resource available at: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${jsonBlock(payload.info)}`;
}
