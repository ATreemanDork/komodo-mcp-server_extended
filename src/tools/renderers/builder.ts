/**
 * Builder Renderers
 *
 * Markdown renderers for `komodo_builder_*` tool responses. No
 * reference-repo equivalent to port (new construction) — modeled on
 * `tools/renderers/alerter.ts`'s list/info shape.
 *
 * @module tools/renderers/builder
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { pageFooter, jsonBlock, type PageInfo } from "./_shared.js";

interface BuilderListItem {
  readonly id: string;
  readonly name: string;
  readonly builder_type?: string;
  readonly instance_type?: string;
}

export function renderBuilderList(payload: { items: readonly BuilderListItem[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.BUILDER} Builders (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo builders configured.`;
  const rows = items
    .map((b) => {
      const type = b.builder_type ? ` | ${b.builder_type}` : "";
      const instance = b.instance_type ? ` (${b.instance_type})` : "";
      return `• ${b.name} (${b.id})${type}${instance}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface BuilderInfoPayload {
  readonly summary: { readonly id: string; readonly name: string };
  readonly info?: unknown;
  readonly resourceLink?: { readonly uri: string };
}

export function renderBuilderInfo(payload: BuilderInfoPayload): string {
  const header = `${RESPONSE_ICONS.INFO} Builder "${payload.summary.name}"`;
  if (payload.resourceLink) {
    return `${header}\n\nFull builder resource available at: \`${payload.resourceLink.uri}\` (request via \`resources/read\`).`;
  }
  return `${header}\n\n${jsonBlock(payload.info)}`;
}
