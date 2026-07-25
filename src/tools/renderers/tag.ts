/**
 * Tag Renderers
 *
 * Markdown renderers for `komodo_tag_*` tool responses.
 *
 * No reference-repo file to port from — modeled on
 * `tools/renderers/alerter.ts`, the closest existing analog (simple
 * Komodo-resource list/info rendering, no resource-link offload).
 *
 * @module tools/renderers/tag
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { pageFooter, jsonBlock, type PageInfo } from "./_shared.js";

interface TagListItem {
  readonly id: string;
  readonly name: string;
  readonly owner?: string;
  readonly color?: string;
}

export function renderTagList(payload: { items: readonly TagListItem[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.TAG} Tags (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo tags configured.`;
  const rows = items
    .map((t) => {
      const color = t.color ? ` | ${t.color}` : "";
      return `• ${t.name} (${t.id})${color}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

interface TagInfoPayload {
  readonly tag: TagListItem;
}

export function renderTagInfo(payload: TagInfoPayload): string {
  const header = `${RESPONSE_ICONS.INFO} Tag "${payload.tag.name}"`;
  return `${header}\n\n${jsonBlock(payload.tag)}`;
}
