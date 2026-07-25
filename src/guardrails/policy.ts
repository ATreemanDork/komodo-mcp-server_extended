/**
 * Guardrail Policy
 *
 * Tier classification for destructive/critical tools. Two tiers only, per
 * the design confirmed with the operator 2026-07-24 (matches the original
 * plan's "primary" layer — dry-run/confirm-token gating):
 * - `destructive` — irreversible or data-destroying (every `*_delete` tool,
 *   `komodo_exec`, and the destructive sub-actions of the four `*_action`
 *   tools that mix safe and destructive operations under one tool).
 * - `critical` — privilege-granting, not delete-shaped (Permission's
 *   `update_*` tools; OnboardingKey's `apply` only when `privileged: true`
 *   is set) — same mechanism, shorter token TTL (`guardrails/confirm.ts`).
 *
 * Elicitation (MCP's `elicitInput()`, the plan's secondary layer) is
 * deliberately NOT implemented — the actual deployment target (LiteLLM MCP
 * gateway) almost certainly doesn't support it, and the plan itself treats
 * the dry-run/confirm path as load-bearing regardless of elicitation
 * support. Deferred per operator confirmation, not built speculatively.
 *
 * `komodo_container_action` is deliberately left ungated — confirmed with
 * the operator: it has zero destructive sub-actions today (start/stop/
 * restart/pause/unpause only, no remove/prune), so nothing in it actually
 * destroys data.
 *
 * @module guardrails/policy
 */

export const GuardrailTiers = {
  DESTRUCTIVE: "destructive",
  CRITICAL: "critical",
} as const;

export type GuardrailTier = (typeof GuardrailTiers)[keyof typeof GuardrailTiers];

/**
 * A tool's guardrail tier can depend on its own (post dry_run/confirm-strip)
 * parsed args — e.g. `*_action` tools where only some `action` values are
 * destructive. Returning `undefined` means "no guardrail for these args."
 */
export type GuardrailClassifier<Args> = (args: Args) => GuardrailTier | undefined;

/**
 * Build a classifier for `*_action`-style tools where only a subset of the
 * `action` enum is destructive — e.g. `komodo_stack_action`'s `destroy` vs
 * `deploy`/`start`/`stop`/etc. The destructive-action lists passed at each
 * call site are grounded directly in `komodo_client`'s actual API surface,
 * not guessed.
 */
export function destructiveWhenActionIn(
  destructiveActions: readonly string[],
): GuardrailClassifier<{ action: string }> {
  return (args) => (destructiveActions.includes(args.action) ? GuardrailTiers.DESTRUCTIVE : undefined);
}
