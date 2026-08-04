/**
 * defineTool()
 *
 * The entire adaptation surface between our tool files and the real
 * `@modelcontextprotocol/sdk`. Tool files import `defineTool` from here —
 * never from a third-party framework — so the protocol layer stays
 * auditable in our own code (this replaces the reference repo's opaque
 * `mcp-server-framework` dependency).
 *
 * `defineTool()` itself does not touch an `McpServer` instance — it returns
 * a plain descriptor object. `src/mcp/registry.ts` collects descriptors,
 * and `src/server/create-server.ts` is the only place that actually calls
 * `McpServer.registerTool()`. This keeps tool handlers unit-testable
 * without booting a transport.
 *
 * Guardrails (dry-run/confirm-token wrapping for destructive/critical
 * tools): a tool config's optional `guardrail` field, resolved via
 * `src/guardrails/policy.ts`, makes `defineTool()` extend the tool's input
 * schema with `dry_run`/`confirm` and wrap its handler in the dry-run/
 * confirm dance (`src/guardrails/confirm.ts`) — the tool's own `handler`
 * never sees those two fields and is otherwise unchanged. This is the ONE
 * place that dance is implemented; every guardrailed tool file just adds a
 * `guardrail: "destructive"` (or a classifier, for `*_action` tools where
 * only some `action` values are destructive) to its existing config.
 *
 * Implementation note on the dry-run/rejected-confirm response shape:
 * both go through `errorResult()` (`isError: true`, no `structuredContent`)
 * rather than trying to fit a preview payload into the tool's own declared
 * `output` schema. Confirmed against the real SDK (`@modelcontextprotocol/
 * sdk`'s `McpServer.validateToolOutput`): any non-error response from a
 * tool with a declared `output` schema MUST carry `structuredContent`
 * matching that exact schema — there's no way to return a differently-
 * shaped "needs confirmation" payload without either (a) editing every
 * guardrailed tool's own output schema to accommodate a second shape, or
 * (b) using the `isError` escape hatch, which the SDK explicitly exempts
 * from output-schema validation. `isError: true` isn't a perfect semantic
 * fit for "not done yet, here's how to proceed" but it's the only path
 * that doesn't require touching every guardrailed tool's output schema,
 * and it's a reasonable steering signal for a calling LLM either way. The
 * CONFIRMED execution path is unaffected — it calls straight through to
 * the tool's original handler and returns its normal, schema-validated
 * result exactly as before.
 *
 * @module mcp/define-tool
 */

import type { AnyZodObject } from "zod";
import { z } from "zod";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { errorResult } from "./content.js";
import { redactObject } from "../utils/redact.js";
import { issueConfirmToken, verifyConfirmToken } from "../guardrails/confirm.js";
import type { GuardrailClassifier, GuardrailTier } from "../guardrails/policy.js";

/** The `extra` argument passed to every tool handler by the SDK. */
export type ToolHandlerExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** A tool handler: validated input in, a `CallToolResult` out. */
export type ToolHandler<Input extends AnyZodObject> = (
  args: z.infer<Input>,
  extra: ToolHandlerExtra,
) => Promise<CallToolResult>;

/** `dry_run`/`confirm` fields merged onto the input schema of any guardrailed tool. */
const guardrailFieldsShape = {
  dry_run: z
    .boolean()
    .optional()
    .describe(
      "Guardrail preview toggle. `dry_run: true` NEVER executes — it always previews. " +
        "Destructive/critical operations (deletes, `destroy`, permission/privilege changes) ALSO preview when " +
        "dry_run is omitted, and return a `confirm` token; re-call with `dry_run: false` plus that exact token " +
        "and identical other arguments to execute. Non-destructive operations run when dry_run is omitted or " +
        "false (no token needed) — pass `dry_run: true` only to preview them without running.",
    ),
  confirm: z
    .string()
    .optional()
    .describe(
      "Guardrail: the `confirm` token returned by a prior preview of this same tool with matching arguments. " +
        "Required to execute a destructive/critical operation (`dry_run: false`); not needed for non-destructive operations.",
    ),
};

export interface ToolDefinitionConfig<Input extends AnyZodObject> {
  /** Tool name as exposed over MCP, e.g. `komodo_server_list`. */
  name: string;
  /** Human-readable description shown to the calling model. */
  description: string;
  /** Zod object schema validating the tool's input arguments. */
  input: Input;
  /** Zod object schema describing the tool's structured output, when it returns one. */
  output?: AnyZodObject;
  /** Standard MCP tool annotations (readOnlyHint, destructiveHint, ...). */
  annotations?: ToolAnnotations;
  /** Opaque metadata surfaced to MCP clients, e.g. `{ category: ToolCategory }` (src/config/categories.ts). */
  _meta?: Record<string, unknown>;
  /**
   * RBAC scopes this tool requires, e.g. `[ToolScopes.READ]` (src/config/scopes.ts).
   * Carried on every tool now but not yet enforced anywhere — passive until scope
   * enforcement itself lands (a separate, still-deferred milestone from guardrails).
   */
  requiredScopes?: readonly string[];
  /**
   * Guardrail tier for this tool (`"destructive"` or `"critical"`), or a
   * classifier deriving the tier from the tool's own parsed args (e.g.
   * `destructiveWhenActionIn([...])` for `*_action` tools where only some
   * `action` values are destructive). Omit for ungated tools. See
   * `src/guardrails/policy.ts`.
   */
  guardrail?: GuardrailTier | GuardrailClassifier<z.infer<Input>>;
  /** The tool's implementation. Never receives `dry_run`/`confirm` even when `guardrail` is set. */
  handler: ToolHandler<Input>;
}

/**
 * Everything `registry.ts`/`create-server.ts` need to register a tool with
 * the real SDK. Not generic over `Input` — `inputSchema`/`handler` are
 * erased to `AnyZodObject` here on purpose (the registry stores
 * heterogeneous tool definitions; each tool file's own `defineTool<Input>`
 * call site still gets a correctly-typed `handler` callback).
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: AnyZodObject;
  readonly outputSchema: AnyZodObject | undefined;
  readonly annotations: ToolAnnotations | undefined;
  readonly _meta: Record<string, unknown> | undefined;
  readonly requiredScopes: readonly string[] | undefined;
  readonly handler: ToolHandler<AnyZodObject>;
}

/**
 * Define an MCP tool descriptor.
 *
 * Does not register anything by itself — call `registerToolDefinition()`
 * (src/mcp/registry.ts) to add it to the in-process registry that
 * `create-server.ts` enumerates.
 */
export function defineTool<Input extends AnyZodObject>(config: ToolDefinitionConfig<Input>): ToolDefinition {
  if (!config.guardrail) {
    return {
      name: config.name,
      description: config.description,
      inputSchema: config.input,
      outputSchema: config.output,
      annotations: config.annotations,
      _meta: config._meta,
      requiredScopes: config.requiredScopes,
      handler: config.handler as ToolHandler<AnyZodObject>,
    };
  }

  const guardrail = config.guardrail;
  const toolName = config.name;
  const extendedInput = config.input.extend(guardrailFieldsShape);

  const wrappedHandler: ToolHandler<AnyZodObject> = async (rawArgs, extra) => {
    const { dry_run, confirm, ...realArgs } = rawArgs as Record<string, unknown> & {
      dry_run?: boolean;
      confirm?: string;
    };
    const tier = typeof guardrail === "function" ? guardrail(realArgs) : guardrail;

    if (!tier) {
      // Non-gated action on a guarded tool (e.g. `deploy`/`start` on a
      // `*_action` tool whose only gated action is `destroy`). Honor an
      // EXPLICIT `dry_run: true` as a no-op preview — never execute — so the
      // schema's "dry_run: true never runs" promise holds for every action.
      // Omitted or `dry_run: false` still runs frictionlessly: non-destructive
      // actions carry no confirm-token requirement.
      if (dry_run === true) {
        return errorResult(
          `🔍 Dry run — this call did NOT run. \`${toolName}\` with these arguments is not a ` +
            "destructive/gated action, so no confirm token is needed. Call again with " +
            "`dry_run: false` (or omit dry_run) to execute.\n\n" +
            `Arguments: ${JSON.stringify(redactObject(realArgs), null, 2)}`,
        );
      }
      return config.handler(realArgs, extra);
    }

    if (dry_run !== false) {
      const { confirm: token, expiresAt } = issueConfirmToken({ tool: toolName, args: realArgs, tier });
      return errorResult(
        `⏸️ Confirmation required (${tier} tier). This call did NOT run.\n\n` +
          `Tool: ${toolName}\nArguments: ${JSON.stringify(redactObject(realArgs), null, 2)}\n\n` +
          "To proceed, call this tool again with the exact same arguments above, plus:\n" +
          `  dry_run: false\n  confirm: "${token}"\n\n` +
          `Token expires at ${new Date(expiresAt).toISOString()} — after that, call again without dry_run (or dry_run: true) for a fresh one.`,
      );
    }

    if (!confirm) {
      return errorResult(
        `Guardrail error: dry_run is false but no confirm token was provided. Call ${toolName} again with dry_run omitted (or true) first to get one.`,
      );
    }
    const verdict = verifyConfirmToken({ token: confirm, tool: toolName, args: realArgs });
    if (!verdict.valid) {
      return errorResult(
        `Guardrail error: confirm token rejected (${verdict.reason ?? "invalid"}). Call ${toolName} again with dry_run omitted (or true) for a fresh token.`,
      );
    }
    return config.handler(realArgs, extra);
  };

  return {
    name: config.name,
    description: config.description,
    inputSchema: extendedInput,
    outputSchema: config.output,
    annotations: config.annotations,
    _meta: config._meta,
    requiredScopes: config.requiredScopes,
    handler: wrappedHandler,
  };
}
