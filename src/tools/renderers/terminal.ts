/**
 * Terminal Renderers
 *
 * Markdown renderers for `komodo_terminal_*` tool responses. Split
 * per-domain rather than one shared `utils/markdown.ts` (981 lines / 37
 * functions in the reference repo) so the domains were ported in parallel
 * without colliding on a shared file.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts, `renderExecResult`) —
 * pulls its primitives (`codeBlock`, `truncate`, `OUTPUT_BUDGET`) from
 * `./_shared.ts` instead of the reference's single monolithic file.
 *
 * @module tools/renderers/terminal
 */

import { RESPONSE_ICONS } from "../../config/index.js";
import { codeBlock, truncate, OUTPUT_BUDGET } from "./_shared.js";

interface ExecPayload {
  readonly target: "server" | "container" | "deployment" | "stack_service";
  readonly command: string;
  readonly output: string;
  readonly exit_code: string | null;
  readonly truncated: boolean;
  readonly server?: string;
  readonly container?: string;
  readonly deployment?: string;
  readonly stack?: string;
  readonly service?: string;
}

export function renderExecResult(payload: ExecPayload): string {
  const targetLabel = (() => {
    switch (payload.target) {
      case "server":
        return `server "${String(payload.server)}"`;
      case "container":
        return `container "${String(payload.container)}" on server "${String(payload.server)}"`;
      case "deployment":
        return `deployment "${String(payload.deployment)}"`;
      case "stack_service":
        return `stack "${String(payload.stack)}" · service "${String(payload.service)}"`;
    }
  })();

  const exit = payload.exit_code ?? "—";
  const exitIcon = payload.exit_code === "0" ? RESPONSE_ICONS.SUCCESS : RESPONSE_ICONS.ERROR;
  const truncatedNote = payload.truncated ? " _(truncated)_" : "";

  const header = `${RESPONSE_ICONS.START} Exec on ${targetLabel}`;
  const meta = `\`$ ${payload.command}\`\n\n${exitIcon} Exit code: ${exit}${truncatedNote}`;
  const body = payload.output ? `\n\n${codeBlock(truncate(payload.output, OUTPUT_BUDGET))}` : "\n\n_(no output)_";

  return `${header}\n\n${meta}${body}`;
}
