/**
 * Container Renderers
 *
 * Markdown renderers for `komodo_container_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts, `renderContainerList`/
 * `renderContainerInspect`/`renderContainerLogs`/`renderContainerSearchLogs`)
 * — pulls its primitives (`stateBadge`, `pageFooter`, `jsonBlock`,
 * `codeBlock`, `truncate`, `OUTPUT_BUDGET`, `PageInfo`) from `./_shared.ts`
 * instead of the reference's single monolithic file.
 *
 * @module tools/renderers/container
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { stateBadge, pageFooter, jsonBlock, codeBlock, truncate, OUTPUT_BUDGET, type PageInfo } from "./_shared.js";

interface ContainerListItem {
  readonly name: string;
  readonly state?: string;
  readonly image?: string;
}

export function renderContainerList(payload: { items: readonly ContainerListItem[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.CONTAINER} Containers (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo containers found.`;
  const rows = items.map((c) => `• ${c.name} (${stateBadge(c.state)}) — ${c.image ?? "Unknown image"}`).join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface ContainerInspectPayload {
  readonly summary: { readonly name: string };
  readonly inspect?: unknown;
  readonly resourceLink?: { readonly uri: string };
}

export function renderContainerInspect(payload: ContainerInspectPayload): string {
  const header = `${RESPONSE_ICONS.INFO} Container "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull Docker inspect payload available as resource: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${jsonBlock(payload.inspect)}`;
}

interface LogPayload {
  readonly summary: { readonly name: string };
  readonly stdout?: string;
  readonly stderr?: string;
  readonly resourceLink?: { readonly uri: string };
}

export function renderContainerLogs(payload: LogPayload): string {
  const header = `${RESPONSE_ICONS.LIST} Logs for container "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull stdout/stderr available as resource: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  const stdout = payload.stdout ?? "";
  const stderr = payload.stderr ?? "";
  if (!stdout && !stderr) return `${header}\n\n(No logs available)`;

  const blocks: string[] = [];
  if (stdout) blocks.push(`**stdout**\n\n${codeBlock(truncate(stdout, OUTPUT_BUDGET))}`);
  if (stderr) blocks.push(`**stderr**\n\n${codeBlock(truncate(stderr, OUTPUT_BUDGET))}`);
  return `${header}\n\n${blocks.join("\n\n")}`;
}

interface SearchMatch {
  readonly stream: "stdout" | "stderr";
  readonly line: string;
}

export function renderContainerSearchLogs(payload: {
  summary: { name: string };
  matches: readonly SearchMatch[];
  resourceLink?: { uri: string };
}): string {
  const { summary, matches, resourceLink } = payload;
  const header = `${RESPONSE_ICONS.LIST} Search results in container "${summary.name}"`;
  const countLine = `Found ${String(matches.length)} matching ${matches.length === 1 ? "line" : "lines"}`;
  if (matches.length === 0) return `${header}\n\n${countLine}`;
  if (resourceLink) {
    return `${header}\n\n${countLine}\n\nFull match list available as resource: ${resourceLink.uri}`;
  }
  const body = matches.map((m) => `[${m.stream}] ${m.line}`).join("\n");
  return `${header}\n\n${countLine}\n\n${codeBlock(truncate(body, OUTPUT_BUDGET))}`;
}
