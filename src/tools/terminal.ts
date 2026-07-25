/**
 * Terminal Execution Tool
 *
 * Consolidated `komodo_exec` tool for executing commands on Komodo servers,
 * containers, deployments, and stack services via the `komodo_client` terminal API.
 *
 * Two execution models share a common output collector:
 * - **Stream-based**: `execute_terminal_stream()` for server terminals (AsyncIterable)
 * - **Callback-based**: `execute_*_exec()` for container/deployment/stack exec (onLine/onFinish)
 *
 * Both share the {@link OutputBuffer} for output collection, truncation, and
 * timeout enforcement.
 *
 * Ported from the reference repo
 * (references/komodo-mcp-server/src/tools/terminal.ts) onto this repo's own
 * `@modelcontextprotocol/sdk` integration. DEVIATION from the reference: all
 * cancellation-signal and progress-callback plumbing is removed, including
 * internally — `OutputBuffer.isActive()` no longer takes a signal parameter
 * (it only ever checks the timeout now), the progress-callback method is
 * dropped entirely (and with it the now-unused `PROGRESS_INTERVAL` /
 * `ESTIMATED_TOTAL_LINES` constants it existed to serve), and both
 * `collectStreamOutput`/`collectCallbackOutput` drop their signal / progress
 * callback parameters and call sites. The buffering, 50 KB truncation, and
 * 5-minute timeout logic itself is unchanged — just unconditional/
 * non-cancellable instead of signal-gated, matching this repo's
 * `wrapApiCall`/`wrapExecuteAndPoll` (which already dropped the same
 * plumbing).
 *
 * @module tools/terminal
 */

import { Types } from "komodo_client";
import { defineTool } from "../mcp/define-tool.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { ToolCategories, ToolScopes } from "../config/index.js";
import { AppErrorFactory } from "../errors/index.js";
import { execInputSchema, execOutputSchema } from "./schemas/terminal.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { renderExecResult } from "./renderers/terminal.js";
import { scrubText } from "../utils/redact.js";

// ============================================================================
// Constants
// ============================================================================

/** Maximum output length returned to the client (characters) */
const MAX_OUTPUT_LENGTH = 50_000;

/** Maximum time to wait for a terminal command to complete (5 minutes) */
const TERMINAL_TIMEOUT_MS = 300_000;

/** Sentinel prefix emitted by Komodo to signal exit code*/
const EXIT_CODE_PREFIX = "__KOMODO_EXIT_CODE:";

/**
 * Parses and validates a raw exit-code value from the Komodo sentinel.
 *
 * The PTY echo can inject the printf format literal `"%d"` or other
 * non-numeric strings before the real sentinel arrives. Any value that
 * is not a valid integer is treated as unknown and returned as `null`.
 */
function parseExitCode(raw: string): string | null {
  const trimmed = raw.trim();
  return /^-?\d+$/.test(trimmed) ? trimmed : null;
}

// ============================================================================
// Output Collection
// ============================================================================

interface TerminalResult {
  readonly output: string;
  readonly exitCode: string | null;
  readonly truncated: boolean;
}

/**
 * Buffers terminal output with truncation and timeout enforcement.
 *
 * Shared between stream-based (server terminals) and callback-based
 * (container/deployment/stack exec) collection methods.
 */
class OutputBuffer {
  private readonly lines: string[] = [];
  private readonly startTime = Date.now();
  private totalLength = 0;
  private truncated = false;
  exitCode: string | null = null;

  /** Returns true if the buffer can still accept lines (not timed out). */
  isActive(): boolean {
    return !this.isTimedOut;
  }

  private get isTimedOut(): boolean {
    return Date.now() - this.startTime > TERMINAL_TIMEOUT_MS;
  }

  /** Append a line to the buffer. Returns false if timed out (caller should stop). */
  addLine(line: string): boolean {
    if (this.isTimedOut) {
      this.lines.push("... [timeout — command may still be running]");
      this.truncated = true;
      return false;
    }

    if (this.truncated) return true;

    this.totalLength += line.length + 1;
    if (this.totalLength > MAX_OUTPUT_LENGTH) {
      this.truncated = true;
      this.lines.push("... [output truncated]");
    } else {
      this.lines.push(line);
    }
    return true;
  }

  /** Mark timeout (used by callback-based timeout race). */
  markTimeout(): void {
    this.lines.push("... [timeout — command may still be running]");
    this.truncated = true;
  }

  getResult(): TerminalResult {
    // Trim leading/trailing empty lines injected by Komodo's scaffold protocol
    // (printf outputs a \n before and after the sentinel lines). Internal blank
    // lines that are part of real command output are preserved.
    const output = this.lines.join("\n").trim();
    return { output, exitCode: this.exitCode, truncated: this.truncated };
  }
}

/**
 * Collects output from an async iterable stream (server terminals).
 * Parses the Komodo exit-code sentinel from the stream.
 */
async function collectStreamOutput(stream: AsyncIterable<string>): Promise<TerminalResult> {
  const buf = new OutputBuffer();

  for await (const line of stream) {
    if (!buf.isActive()) break;

    if (line.startsWith(EXIT_CODE_PREFIX)) {
      buf.exitCode = parseExitCode(line.slice(EXIT_CODE_PREFIX.length));
      continue;
    }

    if (!buf.addLine(line)) break;
  }

  return buf.getResult();
}

/**
 * Collects output from a callback-based exec method (container/deployment/stack).
 * Wraps onLine/onFinish callbacks into a Promise with timeout guard.
 */
function collectCallbackOutput(
  execFn: (callbacks: { onLine: (line: string) => void; onFinish: (code: string) => void }) => Promise<void>,
): Promise<TerminalResult> {
  const buf = new OutputBuffer();
  let timer: NodeJS.Timeout | undefined;

  const execPromise = execFn({
    onLine: (line: string) => {
      if (!buf.isActive()) return;
      buf.addLine(line);
    },
    onFinish: (code: string) => {
      buf.exitCode = parseExitCode(code);
    },
  })
    .finally(() => {
      if (timer) clearTimeout(timer);
    })
    .then(() => buf.getResult());

  const timeoutPromise = new Promise<TerminalResult>((resolve) => {
    timer = setTimeout(() => {
      buf.markTimeout();
      resolve(buf.getResult());
    }, TERMINAL_TIMEOUT_MS);
  });

  return Promise.race([execPromise, timeoutPromise]);
}

// ============================================================================
// Consolidated `komodo_exec` Tool
// ============================================================================

export const execTool = defineTool({
  name: "komodo_exec",
  description: [
    "Execute a shell command on a Komodo target. `target` selects the context:",
    "server (server[, shell, terminal]) | container (server, container[, shell]) | deployment (deployment[, shell]) | stack_service (stack, service[, shell]).",
    "Output ≤50 KB; timeout 5 min.",
  ].join("\n"),
  input: execInputSchema,
  output: execOutputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
  },
  guardrail: "destructive",
  _meta: { category: ToolCategories.TERMINAL },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();

    switch (args.target) {
      case "server": {
        if (!args.server) throw AppErrorFactory.validation.fieldRequired("server");
        const server = args.server;
        const stream = await wrapApiCall("executeServerTerminal", () =>
          komodo.client.execute_terminal_stream({
            target: { type: "Server", params: { server } },
            terminal: args.terminal,
            command: args.command,
            // Wrap the init shell with `stty -echo` to disable PTY input echo.
            // Komodo Periphery sends its command scaffold as a multi-line string
            // to the PTY. Without this, the PTY echoes each scaffold line back
            // into stdout and the sentinel-matching loop in Periphery fires on
            // the echo rather than on the real printf output — causing the stream
            // to close before the actual command output arrives.
            // Workaround until upstream fix: `\n` to `\\n` in the scaffold printf format literal, or a dedicated exec API without the scaffold.
            init: {
              command: `sh -c 'stty -echo; exec ${args.shell}'`,
              recreate: Types.TerminalRecreateMode.DifferentCommand,
            },
          }),
        );
        const result = await collectStreamOutput(stream);
        const payload = {
          target: "server" as const,
          command: scrubText(args.command),
          output: scrubText(result.output),
          exit_code: result.exitCode,
          truncated: result.truncated,
          server,
        };
        return structuredResult(payload, { text: renderExecResult(payload) });
      }

      case "container": {
        if (!args.server) throw AppErrorFactory.validation.fieldRequired("server");
        if (!args.container) throw AppErrorFactory.validation.fieldRequired("container");
        const server = args.server;
        const container = args.container;
        // container/deployment/stack_service exec can return the raw
        // wrapper scaffold ("'; <cmd>; rc=$?; printf '") instead of real output
        // — a sentinel-parsing race in Periphery itself (moghtech/komodo#1289),
        // not this client. Fixed upstream (commit 7cc6f17, targeting Core/
        // Periphery 2.3.0); this instance runs 2.2.0. No request-side
        // workaround exists (confirmed live: stty -echo / recreate-mode
        // changes have no effect, since it's a server-side race, not PTY
        // echo). Re-test once Periphery is upgraded past 2.2.0.
        const result = await wrapApiCall("executeContainerExec", () =>
          collectCallbackOutput((callbacks) =>
            komodo.client.execute_container_exec(
              {
                server,
                container,
                shell: args.shell,
                command: args.command,
              },
              callbacks,
            ),
          ),
        );
        const payload = {
          target: "container" as const,
          command: scrubText(args.command),
          output: scrubText(result.output),
          exit_code: result.exitCode,
          truncated: result.truncated,
          server,
          container,
        };
        return structuredResult(payload, { text: renderExecResult(payload) });
      }

      case "deployment": {
        if (!args.deployment) throw AppErrorFactory.validation.fieldRequired("deployment");
        const deployment = args.deployment;
        // see the container branch's comment above — same upstream
        // Periphery bug (moghtech/komodo#1289), not fixable client-side.
        const result = await wrapApiCall("executeDeploymentExec", () =>
          collectCallbackOutput((callbacks) =>
            komodo.client.execute_deployment_exec(
              {
                deployment,
                shell: args.shell,
                command: args.command,
              },
              callbacks,
            ),
          ),
        );
        const payload = {
          target: "deployment" as const,
          command: scrubText(args.command),
          output: scrubText(result.output),
          exit_code: result.exitCode,
          truncated: result.truncated,
          deployment,
        };
        return structuredResult(payload, { text: renderExecResult(payload) });
      }

      case "stack_service": {
        if (!args.stack) throw AppErrorFactory.validation.fieldRequired("stack");
        if (!args.service) throw AppErrorFactory.validation.fieldRequired("service");
        const stack = args.stack;
        const service = args.service;
        // see the container branch's comment above — same upstream
        // Periphery bug (moghtech/komodo#1289), not fixable client-side.
        const result = await wrapApiCall("executeStackServiceExec", () =>
          collectCallbackOutput((callbacks) =>
            komodo.client.execute_stack_exec(
              {
                stack,
                service,
                shell: args.shell,
                command: args.command,
              },
              callbacks,
            ),
          ),
        );
        const payload = {
          target: "stack_service" as const,
          command: scrubText(args.command),
          output: scrubText(result.output),
          exit_code: result.exitCode,
          truncated: result.truncated,
          stack,
          service,
        };
        return structuredResult(payload, { text: renderExecResult(payload) });
      }
    }
  },
});

registerToolDefinition(execTool);
