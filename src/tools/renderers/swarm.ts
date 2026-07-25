/**
 * Swarm Renderers
 *
 * Markdown renderers for `komodo_swarm_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts, `renderSwarmList`/
 * `renderSwarmInfo`/`renderSwarmNodesList`/`renderSwarmServicesList`) —
 * pulls its primitives (`stateBadge`, `pageFooter`, `jsonBlock`, `PageInfo`)
 * from `./_shared.ts` instead of the reference's single monolithic file.
 *
 * @module tools/renderers/swarm
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { stateBadge, pageFooter, jsonBlock, type PageInfo } from "./_shared.js";

interface SwarmListItem {
  readonly id: string;
  readonly name: string;
  readonly state?: string;
  readonly server_ids?: readonly string[];
  readonly err?: string;
}

export function renderSwarmList(payload: { items: readonly SwarmListItem[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.SWARM} Swarms (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo swarms registered.`;
  const rows = items
    .map((s) => {
      const state = s.state ? ` ${stateBadge(s.state)}` : "";
      const servers = s.server_ids && s.server_ids.length > 0 ? ` | managers: ${String(s.server_ids.length)}` : "";
      const err = s.err ? ` | err: ${s.err}` : "";
      return `• ${s.name} (${s.id})${state}${servers}${err}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface SwarmInfoPayload {
  readonly summary: { readonly id: string; readonly name: string; readonly server_ids?: readonly string[] };
  readonly info?: unknown;
  readonly resourceLink?: { readonly uri: string };
}

export function renderSwarmInfo(payload: SwarmInfoPayload): string {
  const header = `${RESPONSE_ICONS.INFO} Swarm "${payload.summary.name}"`;
  const meta: string[] = [];
  if (payload.summary.server_ids && payload.summary.server_ids.length > 0) {
    meta.push(
      `• Manager servers (${String(payload.summary.server_ids.length)}): ${payload.summary.server_ids.join(", ")}`,
    );
  }
  const metaBlock = meta.length > 0 ? `\n\n${meta.join("\n")}` : "";
  if (payload.resourceLink) {
    return `${header}${metaBlock}\n\nFull swarm resource available at: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}${metaBlock}\n\n${jsonBlock(payload.info)}`;
}

interface SwarmNodeItem {
  readonly id?: string;
  readonly name?: string;
  readonly hostname?: string;
  readonly role?: string;
  readonly availability?: string;
  readonly state?: string;
}

export function renderSwarmNodesList(payload: {
  swarm: string;
  items: readonly SwarmNodeItem[];
  page?: PageInfo;
}): string {
  const { swarm, items, page } = payload;
  const header = `${RESPONSE_ICONS.NODE} Nodes for swarm "${swarm}" (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo nodes reported.`;
  const rows = items
    .map((n) => {
      const id = n.id ? ` (${n.id})` : "";
      const role = n.role ? ` | ${n.role}` : "";
      const avail = n.availability ? ` | ${n.availability}` : "";
      const state = n.state ? ` | ${stateBadge(n.state)}` : "";
      const host = n.hostname && n.hostname !== n.name ? ` | host: ${n.hostname}` : "";
      return `• ${n.name ?? n.hostname ?? "(unnamed)"}${id}${role}${avail}${state}${host}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface SwarmServiceItem {
  readonly id?: string;
  readonly name?: string;
  readonly image?: string;
  readonly mode?: string;
  readonly replicas?: number;
}

export function renderSwarmServicesList(payload: {
  swarm: string;
  items: readonly SwarmServiceItem[];
  page?: PageInfo;
}): string {
  const { swarm, items, page } = payload;
  const header = `${RESPONSE_ICONS.SERVICE} Services on swarm "${swarm}" (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo services running.`;
  const rows = items
    .map((s) => {
      const id = s.id ? ` (${s.id})` : "";
      const img = s.image ? ` | ${s.image}` : "";
      const mode = s.mode ? ` | ${s.mode}` : "";
      const rep = s.replicas !== undefined ? ` | replicas: ${String(s.replicas)}` : "";
      return `• ${s.name ?? "(unnamed)"}${id}${img}${mode}${rep}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}
