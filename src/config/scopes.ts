/**
 * Tool Scopes
 *
 * Three-tier RBAC scope strings attached to every tool via `requiredScopes`.
 * Carried on every tool now, faithfully ported, even though the enforcement
 * layer doesn't exist yet — deliberate, per the decision not
 * to discard already-designed data just because its consumer isn't built
 * yet (recreating it later risks inconsistency across tools).
 *
 * TODO: **Passive today** — nothing in this codebase reads
 * `requiredScopes` yet. Komodo doesn't ship OIDC, so there is no caller
 * identity to check a scope against. Once the guardrail layer lands, this
 * becomes enforced without touching the tool definitions.
 *
 * **Tier semantics** (lowest sufficient tier per tool):
 * - `komodo:read`     — read-only operations (list, info, inspect, logs, stats, health)
 * - `komodo:operate`  — lifecycle operations (`*_action` tools)
 * - `komodo:admin`    — destructive / structural changes (create, update, delete, prune, exec)
 *
 * Tier inclusion (admin > operate > read) is not enforced by this module —
 * it must be expressed by the IdP (e.g. an admin user gets all three scopes
 * in the token) or by a future scope-expansion helper.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/config/scopes.ts).
 *
 * @module config/scopes
 */

export const ToolScopes = {
  READ: "komodo:read",
  OPERATE: "komodo:operate",
  ADMIN: "komodo:admin",
} as const;

export type ToolScope = (typeof ToolScopes)[keyof typeof ToolScopes];
