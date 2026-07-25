/**
 * Toml Renderers
 *
 * Markdown renderer for `komodo_toml_*` tool responses. No reference-repo file
 * to port from — single-string TOML payload, no list/info split needed.
 *
 * @module tools/renderers/toml
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { codeBlock, truncate, OUTPUT_BUDGET } from "./_shared.js";

export function renderTomlExport(payload: { toml: string }): string {
  const header = `${RESPONSE_ICONS.TOML} Exported sync TOML (${String(payload.toml.length)} chars)`;
  return `${header}\n\n${codeBlock(truncate(payload.toml, OUTPUT_BUDGET), "toml")}`;
}
