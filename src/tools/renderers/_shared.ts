/**
 * Shared Markdown Renderer Primitives
 *
 * `renderActionResult` and the primitives it depends on are used verbatim by
 * domain renderers across all domains (deployment, stack,
 * build, repo, action, procedure, server, swarm, container, resource-sync).
 * Built centrally here — once — rather than copy-pasted into each
 * per-domain file, so the parallel ports can't independently diverge on
 * the same function. Ported from the reference repo's `utils/markdown.ts`.
 *
 * @module tools/renderers/_shared
 */

import type { Types } from "komodo_client";
import { RESPONSE_ICONS } from "../../config/index.js";
import type { ActionResult } from "../../utils/polling.js";
import type { ActionType } from "../../utils/response-formatter.js";
import { redactObject, scrubText } from "../../utils/redact.js";

type Log = Types.Log;

/** Truncation budget for log/output blocks embedded in Markdown text. */
export const OUTPUT_BUDGET = 4000;

/** Map a state value to an emoji prefix for at-a-glance status. */
export function stateBadge(state: string | undefined): string {
  if (!state) return "—";
  const s = state.toLowerCase();
  if (s === "running" || s === "ok" || s === "healthy") return `🟢 ${state}`;
  if (s === "paused") return `⏸️ ${state}`;
  if (s === "restarting") return `🔄 ${state}`;
  if (s === "exited" || s === "stopped" || s === "dead") return `🔴 ${state}`;
  if (s === "created") return `⚪ ${state}`;
  if (s === "unhealthy" || s === "disabled") return `🟠 ${state}`;
  return state;
}

/** Truncate a string to `max` characters with a trailing ellipsis note. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…(${String(value.length - max)} more chars truncated)`;
}

/** Render a value inside a fenced code block. Empty values produce a placeholder. */
export function codeBlock(value: string, language = ""): string {
  if (!value || value.trim() === "") return "_(empty)_";
  return `\`\`\`${language}\n${value}\n\`\`\``;
}

/**
 * Pretty-print an unknown payload as JSON inside a fenced ```json block.
 * Secrets are scrubbed ({@link redactObject}) before serialization — this is
 * the single render primitive every `*_info`/`*_inspect` renderer calls, so
 * redacting here protects the inline path everywhere it is used.
 */
export function jsonBlock(value: unknown): string {
  try {
    return codeBlock(JSON.stringify(redactObject(value), null, 2), "json");
  } catch {
    return "_(payload not serializable)_";
  }
}

export interface PageInfo {
  readonly next_cursor?: string;
  readonly total?: number;
}

/** Append a pagination footer line when more pages are available. */
export function pageFooter(page: PageInfo | undefined, shown: number): string {
  if (!page) return "";
  if (page.next_cursor) {
    const total = page.total !== undefined ? ` of ${String(page.total)}` : "";
    return `\n\n_Showing ${String(shown)}${total}. More results available — pass \`cursor: "${page.next_cursor}"\` for the next page._`;
  }
  return "";
}

const ACTION_ICONS: Record<ActionType, string> = {
  deploy: RESPONSE_ICONS.DEPLOY,
  pull: RESPONSE_ICONS.PULL,
  start: RESPONSE_ICONS.START,
  restart: RESPONSE_ICONS.RESTART,
  pause: RESPONSE_ICONS.PAUSE,
  unpause: RESPONSE_ICONS.UNPAUSE,
  stop: RESPONSE_ICONS.STOP,
  destroy: RESPONSE_ICONS.DELETE,
  create: RESPONSE_ICONS.CREATE,
  update: RESPONSE_ICONS.UPDATE,
  remove: RESPONSE_ICONS.DELETE,
};

const ACTION_PAST_TENSE: Record<ActionType, string> = {
  deploy: "deployed",
  pull: "pull initiated",
  start: "started",
  restart: "restarted",
  pause: "paused",
  unpause: "unpaused",
  stop: "stopped",
  destroy: "destroyed",
  create: "created",
  update: "updated",
  remove: "removed",
};

/**
 * Optional context that augments the rendered text but is not part of the
 * canonical `structuredContent` payload.
 *
 * - `updateId`: Komodo Update ID (for traceability in the UI).
 * - `logs`: Update log entries (stdout/stderr per stage). The renderer picks
 *   the most relevant entries (last 2 on success, all failed/stderr on
 *   failure) and embeds them as fenced code blocks.
 */
export interface ActionResultExtras {
  readonly updateId?: string;
  readonly logs?: readonly Log[];
}

export function renderActionResult(payload: ActionResult, extras?: ActionResultExtras): string {
  const baseAction = (payload.action.split("-")[0] ?? payload.action) as ActionType;
  const knownAction = baseAction in ACTION_ICONS;
  const icon = payload.success
    ? knownAction
      ? ACTION_ICONS[baseAction]
      : RESPONSE_ICONS.SUCCESS
    : RESPONSE_ICONS.ERROR;
  const pastTense = knownAction ? ACTION_PAST_TENSE[baseAction] : payload.action;
  const outcome = payload.success ? pastTense : `${payload.action} failed`;
  const resourceLabel = payload.resource_type.charAt(0).toUpperCase() + payload.resource_type.slice(1);

  const headline =
    payload.server && payload.server !== payload.resource_id
      ? `${icon} ${resourceLabel} "${payload.resource_id}" ${outcome} on server "${payload.server}".`
      : `${icon} ${resourceLabel} "${payload.resource_id}" ${outcome}.`;

  const details: string[] = [];
  details.push(`Result: ${payload.success ? "✅ Success" : "❌ Failed"}`);
  details.push(`Status: ${payload.status}`);
  if (extras?.updateId) details.push(`Update ID: ${extras.updateId}`);
  if (payload.version) details.push(`Version: ${payload.version}`);

  let message = `${headline}\n\n${details.join("\n")}`;

  if (extras?.logs && extras.logs.length > 0) {
    const relevant = payload.success
      ? extras.logs.filter((l) => l.stdout.trim() || l.stderr.trim()).slice(-2)
      : extras.logs.filter((l) => !l.success || l.stderr.trim());

    if (relevant.length > 0) {
      message += `\n\n${payload.success ? "📋 Output:" : "📋 Error details:"}`;
      for (const log of relevant) {
        if (log.stage) message += `\n\n[${log.stage}]`;
        const output = log.stderr.trim() || log.stdout.trim();
        if (output) message += `\n${codeBlock(truncate(scrubText(output), 1000))}`;
      }
    }
  }

  return message;
}
