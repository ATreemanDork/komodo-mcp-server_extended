/**
 * User Renderers
 *
 * Markdown renderers for `komodo_user_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts,
 * `renderApiKeyList`/`renderApiKeyCreated`) — pulls its primitives
 * (`pageFooter`, `PageInfo`) from `./_shared.ts` instead of the
 * reference's single monolithic file.
 *
 * @module tools/renderers/user
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { pageFooter, type PageInfo } from "./_shared.js";

interface ApiKeyListItem {
  readonly name: string;
  readonly key: string;
  readonly created_at: number;
  readonly expires: number;
}

export function renderApiKeyList(payload: { items: readonly ApiKeyListItem[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.AUTH} API keys (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo API keys.`;
  const rows = items
    .map((k) => {
      const created = new Date(k.created_at).toISOString().slice(0, 10);
      const expires = k.expires === 0 ? "never" : new Date(k.expires).toISOString().slice(0, 10);
      return `• ${k.name} — Key: \`${k.key}\` | Created: ${created} | Expires: ${expires}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

export function renderApiKeyCreated(payload: {
  readonly name: string;
  readonly key: string;
  readonly secret: string;
  readonly expires: number;
}): string {
  const expires = payload.expires === 0 ? "never" : new Date(payload.expires).toISOString().slice(0, 10);
  const header = `${RESPONSE_ICONS.SUCCESS} API key "${payload.name}" created.`;
  const details = [
    `Key: \`${payload.key}\``,
    `Secret: \`${payload.secret}\` _(shown only on creation — store it now)_`,
    `Expires: ${expires}`,
  ].join("\n");
  return `${header}\n\n${details}`;
}
