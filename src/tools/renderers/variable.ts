/**
 * Variable Renderers
 *
 * Markdown renderers for `komodo_variable_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts,
 * `renderVariableList`/`renderVariableInfo`) — pulls its primitives
 * (`pageFooter`, `PageInfo`) from `./_shared.ts` instead of the
 * reference's single monolithic file.
 *
 * @module tools/renderers/variable
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { pageFooter, type PageInfo } from "./_shared.js";

interface VariableSummary {
  readonly name: string;
  readonly value: string;
  readonly description?: string;
  readonly is_secret?: boolean;
}

export function renderVariableList(payload: { items: readonly VariableSummary[]; page?: PageInfo }): string {
  const { items, page } = payload;
  const header = `${RESPONSE_ICONS.VARIABLE} Variables (${String(items.length)})`;
  if (items.length === 0) return `${header}\n\nNo variables defined.`;
  const rows = items
    .map((v) => {
      const secret = v.is_secret ? " 🔒" : "";
      const desc = v.description ? ` — ${v.description}` : "";
      const value = v.is_secret ? "(secret)" : v.value === "" ? "_(empty)_" : v.value;
      return `• \`${v.name}\`${secret} = ${value}${desc}`;
    })
    .join("\n");
  return `${header}\n\n${rows}${pageFooter(page, items.length)}`;
}

export function renderVariableInfo(payload: { variable: VariableSummary }): string {
  const { variable } = payload;
  const secret = variable.is_secret ? " 🔒 secret" : "";
  const lines = [
    `${RESPONSE_ICONS.VARIABLE} Variable \`${variable.name}\`${secret}`,
    "",
    `• Value: ${variable.is_secret ? "(secret)" : variable.value === "" ? "_(empty)_" : `\`${variable.value}\``}`,
  ];
  if (variable.description) lines.push(`• Description: ${variable.description}`);
  return lines.join("\n");
}
