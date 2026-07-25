/**
 * Variable Schemas
 *
 * Zod schemas for Komodo Variables (`komodo_variable_*` tools).
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/tools/schemas/variable.ts) — `z`
 * imported from `zod` directly rather than the reference's third-party
 * framework re-export, which we don't depend on.
 *
 * @module tools/schemas/variable
 */

import { z } from "zod";
import { pageOutputSchema } from "./shared.js";

// Mirrors Komodo Core's own validation (bin/core/src/helpers/validations.rs,
// `validate_variable_name`) — checked client-side so a bad name fails fast
// with a clear message instead of an opaque API 400.
export const variableNameSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-zA-Z_][a-zA-Z0-9_]*$/,
    "Variable name must start with a letter or underscore and contain only letters, digits, and underscores (no hyphens)",
  )
  .describe("Variable name (unique key) — letters, digits, underscores only; must start with a letter or underscore");

export const variableSummarySchema = z.object({
  name: z.string().describe("Variable name"),
  value: z
    .string()
    .describe(
      'Variable value — the literal string "[redacted]" when the variable is marked secret; this server masks secret values unconditionally, regardless of caller',
    ),
  description: z.string().optional().describe("Optional human-readable description"),
  is_secret: z.boolean().optional().describe("True if the value is treated as a secret"),
});

export const variableListOutputSchema = z
  .object({
    items: z.array(variableSummarySchema).describe("Variables registered in Komodo"),
    page: pageOutputSchema.optional(),
  })
  .describe("List of registered variables");

export const variableInfoOutputSchema = z
  .object({
    variable: variableSummarySchema,
  })
  .describe("Detailed information about a variable");

/**
 * Input for `komodo_variable_apply` (create-or-update).
 *
 * Flat schema: name is always required; value/description/is_secret optional.
 * The handler dispatches based on `action` and validates required fields at runtime.
 */
export const variableApplyInputSchema = z.object({
  action: z
    .enum(["create", "update"])
    .describe(
      "'create' to register a new variable, 'update' to change an existing variable's value/description/is_secret",
    ),
  name: variableNameSchema,
  value: z.string().optional().describe("Variable value — required for action='create'; optional for update"),
  description: z.string().optional().describe("Optional description"),
  is_secret: z.boolean().optional().describe("If true, mark the variable as a secret (value redacted in responses)"),
});
