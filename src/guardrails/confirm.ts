/**
 * Guardrail Confirm Tokens
 *
 * HMAC-signed, short-TTL tokens binding a guardrailed tool call's dry-run
 * preview to its eventual confirmed execution. Design confirmed with the
 * operator 2026-07-24:
 * - No live per-tool preview data (would require editing every destructive
 *   handler individually — a much bigger diff). The token instead binds
 *   the tool name plus a canonical hash of the exact arguments, so any
 *   param tampering between the dry-run call and the confirmed call is
 *   rejected — that's the core safety property, not a live resource lookup.
 * - Signing key: auto-generated random bytes at process boot, with an
 *   optional `GUARDRAIL_HMAC_SECRET` env var override (`config/env.ts`) for
 *   anyone who wants a token to remain valid across a restart. A restart
 *   between dry-run and confirm just expires the in-flight token early —
 *   a safe failure (forces a fresh dry-run call), not a vulnerability,
 *   since tokens only ever need to live seconds-to-minutes.
 *
 * @module guardrails/confirm
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config/index.js";
import type { GuardrailTier } from "./policy.js";

const SIGNING_SECRET = config.GUARDRAIL_HMAC_SECRET ?? randomBytes(32).toString("hex");

/**
 * Consumed token signatures (the MAC segment) → their expiry, so a confirm
 * token can be verified at most ONCE. Without this, a stateless HMAC is
 * replayable for its whole TTL — a leaked/re-sent token could re-run the same
 * destructive call repeatedly. Entries are pruned lazily on verify; every
 * entry self-expires with the token's own TTL, so the map stays bounded.
 */
const consumedTokens = new Map<string, number>();

/** Token lifetime per tier. Critical tools get a shorter window, per the plan. */
export const GUARDRAIL_TTL_MS: Record<GuardrailTier, number> = {
  destructive: 5 * 60_000,
  critical: 60_000,
};

/** Recursively sort object keys so arg equality doesn't depend on key order between the dry-run and confirm calls. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function hashArgs(tool: string, args: unknown): string {
  return createHmac("sha256", SIGNING_SECRET)
    .update(tool)
    .update("\0")
    .update(JSON.stringify(canonicalize(args)))
    .digest("hex");
}

interface TokenPayload {
  tool: string;
  argsHash: string;
  tier: GuardrailTier;
  exp: number;
}

function sign(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", SIGNING_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function unsign(token: string): TokenPayload | undefined {
  const [body, mac] = token.split(".");
  if (!body || !mac) return undefined;
  const expectedMac = createHmac("sha256", SIGNING_SECRET).update(body).digest("base64url");
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expectedMac);
  if (macBuf.length !== expectedBuf.length || !timingSafeEqual(macBuf, expectedBuf)) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "tool" in parsed &&
      "argsHash" in parsed &&
      "tier" in parsed &&
      "exp" in parsed
    ) {
      return parsed as TokenPayload;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function issueConfirmToken(input: { tool: string; args: unknown; tier: GuardrailTier }): {
  confirm: string;
  expiresAt: number;
} {
  const exp = Date.now() + GUARDRAIL_TTL_MS[input.tier];
  const payload: TokenPayload = { tool: input.tool, argsHash: hashArgs(input.tool, input.args), tier: input.tier, exp };
  return { confirm: sign(payload), expiresAt: exp };
}

export interface VerifyResult {
  readonly valid: boolean;
  readonly reason?: string;
}

export function verifyConfirmToken(input: { token: string; tool: string; args: unknown }): VerifyResult {
  const payload = unsign(input.token);
  if (!payload) return { valid: false, reason: "malformed or tampered token" };
  if (payload.tool !== input.tool) return { valid: false, reason: "token was issued for a different tool" };
  if (Date.now() > payload.exp) return { valid: false, reason: "token expired" };
  if (payload.argsHash !== hashArgs(input.tool, input.args)) {
    return { valid: false, reason: "arguments changed since the dry-run preview" };
  }
  // Single-use: a token verifies at most once. Prune expired entries first so
  // the map stays bounded, then reject a replay of one already consumed.
  const mac = input.token.split(".")[1];
  if (mac) {
    const now = Date.now();
    for (const [m, exp] of consumedTokens) if (exp <= now) consumedTokens.delete(m);
    if (consumedTokens.has(mac)) return { valid: false, reason: "confirm token already used" };
    consumedTokens.set(mac, payload.exp);
  }
  return { valid: true };
}
