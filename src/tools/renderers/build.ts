/**
 * Build Renderers
 *
 * Markdown renderers for `komodo_build_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts,
 * `renderBuildList`/`renderBuildInfo`/`renderBuildLogs`) — pulls its
 * primitives (`stateBadge`, `pageFooter`, `jsonBlock`, `codeBlock`,
 * `truncate`, `OUTPUT_BUDGET`, `PageInfo`) from `./_shared.ts` instead of
 * the reference's single monolithic file.
 *
 * @module tools/renderers/build
 */

import type { Types } from "komodo_client";
import { RESPONSE_ICONS } from "../../config/index.js";
import { stateBadge, pageFooter, jsonBlock, codeBlock, truncate, OUTPUT_BUDGET, type PageInfo } from "./_shared.js";

type Log = Types.Log;

interface BuildListItem {
  readonly id: string;
  readonly name: string;
  readonly state?: string;
  readonly version?: string;
  readonly builder_id?: string;
  readonly repo?: string;
  readonly branch?: string;
}

export function renderBuildList(payload: { items: readonly BuildListItem[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.BUILD} Builds (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo builds found.`;
  const rows = items
    .map((b) => {
      const version = b.version ? ` v${b.version}` : "";
      const repo = b.repo ? ` | ${b.repo}${b.branch ? `@${b.branch}` : ""}` : "";
      return `• ${b.name} (${b.id})${version} — ${stateBadge(b.state)}${repo}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface BuildInfoPayload {
  readonly summary: { readonly id: string; readonly name: string };
  readonly info?: unknown;
  readonly resourceLink?: { readonly uri: string };
}

export function renderBuildInfo(payload: BuildInfoPayload): string {
  const header = `${RESPONSE_ICONS.INFO} Build "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull build resource available at: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${jsonBlock(payload.info)}`;
}

interface BuildLogsPayload {
  readonly summary: { readonly id: string; readonly name: string };
  readonly update_id: string;
  readonly success: boolean;
  readonly status: string;
  readonly logs?: readonly Log[];
  readonly resourceLink?: { readonly uri: string };
}

export function renderBuildLogs(payload: BuildLogsPayload): string {
  const header = `${RESPONSE_ICONS.BUILD} Build logs for "${payload.summary.name}" (${payload.update_id})`;
  const meta = `Status: ${payload.status} — ${payload.success ? "✅ Success" : "❌ Failed"}`;
  if (payload.resourceLink) {
    return `${header}\n\n${meta}\n\nFull per-stage logs available as resource: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  if (!payload.logs || payload.logs.length === 0) {
    return `${header}\n\n${meta}\n\n(No logs recorded)`;
  }
  const blocks = payload.logs.map((l) => {
    const stageHead = `**[${l.stage}]** ${l.success ? "✅" : "❌"}${l.command ? ` — \`${l.command}\`` : ""}`;
    const out = l.stdout ? `\n\nstdout:\n\n${codeBlock(truncate(l.stdout, OUTPUT_BUDGET))}` : "";
    const err = l.stderr ? `\n\nstderr:\n\n${codeBlock(truncate(l.stderr, OUTPUT_BUDGET))}` : "";
    return `${stageHead}${out}${err}`;
  });
  return `${header}\n\n${meta}\n\n${blocks.join("\n\n")}`;
}
