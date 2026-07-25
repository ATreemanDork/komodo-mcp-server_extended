/**
 * Duration Schema Helper
 *
 * Small, self-contained Zod preprocessor accepting either a plain positive
 * integer (milliseconds) or a human-readable duration string ("30s", "1m",
 * "2h") and normalizing to milliseconds.
 *
 * This replaces mcp-server-framework's `durationSchema` — authored locally
 * per the scope decision to not depend on the framework package.
 *
 * @module config/duration
 */

import { z } from "zod";

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i;

const DURATION_MULTIPLIERS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses a duration string ("30s", "1m", "2h") or a plain numeric string
 * ("5000") into milliseconds. Throws if the format is unrecognized.
 */
export function parseDurationString(value: string): number {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const match = DURATION_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error(
      `Invalid duration format: "${value}". Use formats like "30s", "1m", "2h", or a plain millisecond count.`,
    );
  }
  const amount = Number(match[1] ?? "");
  const unit = (match[2] ?? "ms").toLowerCase();
  const multiplier = DURATION_MULTIPLIERS[unit] ?? 1;
  return Math.floor(amount * multiplier);
}

function safeParseDuration(value: string): number {
  try {
    return parseDurationString(value);
  } catch {
    return Number.NaN;
  }
}

/**
 * Builds a Zod schema that accepts either a plain positive integer
 * (milliseconds) or a human-readable duration string, defaulting to parsing
 * `defaultValue` when the input is undefined/unset.
 *
 * Callers pipe the result through further numeric validation, e.g.
 * `durationSchema("30s").pipe(z.number().int().positive())`.
 */
export function durationSchema(defaultValue: string): z.ZodEffects<z.ZodTypeAny, number, unknown> {
  return z.preprocess((value) => {
    if (value === undefined) return safeParseDuration(defaultValue);
    if (typeof value === "number") return value;
    if (typeof value === "string") return safeParseDuration(value);
    return value;
  }, z.number());
}
