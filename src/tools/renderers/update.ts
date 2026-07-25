/**
 * Update Renderers
 *
 * Markdown renderers for `komodo_update_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts,
 * `renderUpdateList`/`renderUpdateInfo`) — pulls its primitives
 * (`pageFooter`, `jsonBlock`, `PageInfo`) from `./_shared.ts` instead of the
 * reference's single monolithic file. `formatTs` is domain-local (not part
 * of `_shared.ts`) since only update rendering needs it.
 *
 * @module tools/renderers/update
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { pageFooter, jsonBlock, type PageInfo } from "./_shared.js";

interface UpdateSummaryRender {
  readonly id: string;
  readonly operation: string;
  readonly status: string;
  readonly success?: boolean;
  readonly start_ts?: number;
  readonly end_ts?: number;
  readonly target_type?: string;
  readonly target_id?: string;
  readonly username?: string;
}

function formatTs(ts: number | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return String(ts);
  }
}

export function renderUpdateList(payload: { items: readonly UpdateSummaryRender[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.UPDATE_LOG} Updates (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo update history.`;
  const rows = items
    .map((u) => {
      const result = u.status === "Complete" ? (u.success ? "✅" : "❌") : u.status === "InProgress" ? "🔄" : "⏳";
      const target = u.target_type ? ` | ${u.target_type}${u.target_id ? `:${u.target_id}` : ""}` : "";
      const user = u.username ? ` by ${u.username}` : "";
      return `• ${result} ${u.operation} (${u.id}) — ${formatTs(u.start_ts)}${target}${user}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface UpdateInfoPayload {
  readonly summary: UpdateSummaryRender;
  readonly info?: unknown;
  readonly resourceLink?: { readonly uri: string };
}

export function renderUpdateInfo(payload: UpdateInfoPayload): string {
  const { summary } = payload;
  const header = `${RESPONSE_ICONS.UPDATE_LOG} Update ${summary.id} — ${summary.operation}`;
  const meta = [
    `• Status: ${summary.status}${summary.success !== undefined ? ` (${summary.success ? "✅ success" : "❌ failed"})` : ""}`,
    `• Started: ${formatTs(summary.start_ts)}`,
    summary.end_ts ? `• Ended: ${formatTs(summary.end_ts)}` : null,
    summary.target_type ? `• Target: ${summary.target_type}${summary.target_id ? `:${summary.target_id}` : ""}` : null,
    summary.username ? `• User: ${summary.username}` : null,
  ]
    .filter((v): v is string => v !== null)
    .join("\n");
  if (payload.resourceLink) {
    return `${header}\n\n${meta}\n\nFull update payload (per-stage logs) available at: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${meta}\n\n${jsonBlock(payload.info)}`;
}
