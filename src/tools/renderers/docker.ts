/**
 * Docker Introspection Renderers
 *
 * Markdown renderers for `komodo_docker_*` tool responses. Modeled on
 * `renderers/container.ts`'s summary/inspect split — see that file's header
 * for why renderers are split per-domain rather than one shared file.
 *
 * @module tools/renderers/docker
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { pageFooter, jsonBlock, type PageInfo } from "./_shared.js";

// ============================================================================
// Images
// ============================================================================

interface ImageSummary {
  readonly id: string;
  readonly name: string;
  readonly tags?: readonly string[];
  readonly size?: number;
  readonly in_use?: boolean;
}

export function renderImageList(payload: { items: readonly ImageSummary[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.IMAGE} Docker images (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo images found.`;
  const rows = items
    .map(
      (i) =>
        `• ${i.name}${i.in_use ? " (in use)" : ""} — ${i.size !== undefined ? `${String(Math.round(i.size / 1024 / 1024))} MB` : "unknown size"}`,
    )
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface InspectPayload {
  readonly summary: { readonly name: string };
  readonly inspect?: unknown;
  readonly resourceLink?: { readonly uri: string };
}

export function renderImageInspect(payload: InspectPayload): string {
  const header = `${RESPONSE_ICONS.IMAGE} Image "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull Docker inspect payload available as resource: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${jsonBlock(payload.inspect)}`;
}

interface ImageHistoryEntry {
  readonly id: string;
  readonly created: number;
  readonly created_by: string;
  readonly size: number;
  readonly tags?: readonly string[];
}

export function renderImageHistory(payload: {
  summary: { name: string };
  items: readonly ImageHistoryEntry[];
  resourceLink?: { uri: string };
}): string {
  const header = `${RESPONSE_ICONS.IMAGE} Layer history for "${payload.summary.name}" (${String(payload.items.length)} layers)`;
  if (payload.resourceLink) {
    return `${header}\n\nFull layer history available as resource: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  if (payload.items.length === 0) return `${header}\n\nNo layer history found.`;
  const rows = payload.items
    .map((l) => `• ${String(Math.round(l.size / 1024 / 1024))} MB — ${l.created_by || "(empty layer)"}`)
    .join("\n");
  return `${header}\n\n${rows}`;
}

// ============================================================================
// Networks
// ============================================================================

interface NetworkSummary {
  readonly name?: string;
  readonly id?: string;
  readonly driver?: string;
  readonly scope?: string;
}

export function renderNetworkList(payload: { items: readonly NetworkSummary[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.NETWORK} Docker networks (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo networks found.`;
  const rows = items
    .map((n) => `• ${n.name ?? "(unnamed)"} — driver: ${n.driver ?? "unknown"}, scope: ${n.scope ?? "unknown"}`)
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

export function renderNetworkInspect(payload: InspectPayload): string {
  const header = `${RESPONSE_ICONS.NETWORK} Network "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull Docker inspect payload available as resource: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${jsonBlock(payload.inspect)}`;
}

// ============================================================================
// Volumes
// ============================================================================

interface VolumeSummary {
  readonly name: string;
  readonly driver?: string;
  readonly mountpoint?: string;
  readonly in_use?: boolean;
}

export function renderVolumeList(payload: { items: readonly VolumeSummary[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.VOLUME} Docker volumes (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo volumes found.`;
  const rows = items
    .map((v) => `• ${v.name}${v.in_use ? " (in use)" : ""} — driver: ${v.driver ?? "unknown"}`)
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

export function renderVolumeInspect(payload: InspectPayload): string {
  const header = `${RESPONSE_ICONS.VOLUME} Volume "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull Docker inspect payload available as resource: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${jsonBlock(payload.inspect)}`;
}
