/**
 * Output Redaction
 *
 * Central secret-scrubbing for the tool-output channel. The MCP server's
 * responses flow through a gateway to the calling model / model-provider, so
 * any secret value that reaches `content`, `structuredContent`, an ephemeral
 * `resource_link` payload, or the logs is exposed. Upstream issue
 * MP-Tool/komodo-mcp-server#160 ("Secrets can leak through tool output")
 * named the root cause precisely: the shared response builders never redact,
 * so every write/delete/info path leaks whatever config it carries.
 *
 * This module is the single scrubbing layer wired into those choke points
 * (`buildApplyResult`/`buildDeleteResult`, `jsonBlock`, the `*_info`
 * resource-link content, the guardrail dry-run echo). It builds on the
 * detection primitive that already existed in the repo (`isSensitiveKey`),
 * which until now was wired only into validation-error redaction, never the
 * actual output surface.
 *
 * Three kinds of secret need three handlers, because they are signalled
 * differently:
 *  - key-name-signalled (`token`, `webhook_secret`, `passkey`, `secret_args`,
 *    `private_key`, …) → {@link redactObject} replaces the value by key name.
 *  - value-blob env fields (`environment`, Docker `Config.Env`) → the secret
 *    is inside a `KEY=VALUE` blob, so {@link maskEnvPairs} masks the value
 *    side per-pair by the *inner* key name.
 *  - unstructured log/command text (`docker login -p …`, tokenised URLs,
 *    `Authorization: Bearer …`) → {@link scrubText} pattern-masks the string.
 *
 * Conditionally-secret fields whose secrecy depends on a sibling flag (e.g. a
 * Variable's `value` gated by `is_secret`) are NOT handled here — the key
 * name alone can't tell, so those domains pre-map their own result (see
 * `tools/variable.ts`), mirroring the Provider domain's `has_token` pattern.
 *
 * @module utils/redact
 */

import { isSensitiveKey } from "../errors/sensitive-keys.js";

/** Placeholder substituted for any redacted value. */
export const REDACTED = "[redacted]";

/**
 * Field names whose value is a `KEY=VALUE` env blob (a string of newline-
 * separated pairs, or an array of such strings — Docker's `Config.Env`).
 * Compared case-insensitively so both `environment` and Docker's `Env` match.
 */
const ENV_BLOB_KEYS = new Set(["environment", "env"]);

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Mask the value side of one `KEY=VALUE` line when the key is sensitive. */
function maskEnvLine(line: string): string {
  const eq = line.indexOf("=");
  if (eq <= 0) return line;
  const key = line.slice(0, eq).trim();
  return isSensitiveKey(key) ? `${line.slice(0, eq)}=${REDACTED}` : line;
}

/**
 * Mask secrets inside a `KEY=VALUE` env blob, preserving shape. Accepts a
 * newline-separated string (Komodo's `environment`) or a string array
 * (Docker's `Config.Env`); the value side is masked only where the pair's own
 * key is sensitive, so non-secret env keys stay visible for debugging.
 */
export function maskEnvPairs<T extends string | readonly string[]>(value: T): T {
  if (isStringArray(value)) {
    return value.map(maskEnvLine) as unknown as T;
  }
  if (typeof value === "string") {
    return value.split("\n").map(maskEnvLine).join("\n") as T;
  }
  return value;
}

/**
 * Deep-copy `value`, replacing any sensitive field's value with
 * {@link REDACTED} (by key name) and masking any env-blob field per-pair.
 * Arrays and nested objects are walked; primitives pass through. Plain JSON
 * data only (Komodo API results) — no cycle handling, same as the
 * `JSON.stringify` it feeds.
 */
export function redactObject<T>(value: T): T {
  return redact(value) as T;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (/public/i.test(key)) {
        // A field whose name says "public" is public by definition — a
        // `public_key` / `ssh_public_key` is an identifier, not a secret.
        // `isSensitiveKey` matches it (it contains "key"), so this guard must
        // run FIRST or we'd redact identifiers that later calls need (e.g.
        // OnboardingKey's public_key used for update/delete).
        out[key] = redact(v);
      } else if (isSensitiveKey(key)) {
        out[key] = REDACTED;
      } else if (ENV_BLOB_KEYS.has(key.toLowerCase()) && (typeof v === "string" || isStringArray(v))) {
        out[key] = maskEnvPairs(v);
      } else if (key.toLowerCase() === "command" && typeof v === "string") {
        // Free-form shell command (systemCommand.command on stack/build/repo
        // configs) — the secret is inside the string (`docker login -p …`,
        // tokenised URLs), not the key name, so pattern-scrub the value.
        out[key] = scrubText(v);
      } else {
        out[key] = redact(v);
      }
    }
    return out;
  }
  return value;
}

/**
 * Pattern-scrub secrets from unstructured text (command strings, captured
 * update-log stdout/stderr). Unlike {@link redactObject} this operates on the
 * string itself — the data is not key/value shaped. Covers the credential
 * shapes issue #160 enumerates: `-p`/`--password` flags, credentials embedded
 * in `https://…@` URLs, and `Authorization: Bearer/Basic` headers.
 */
export function scrubText(text: string): string {
  return text
    .replace(/(--password|--pass|-p)(\s+|=)\S+/gi, `$1$2${REDACTED}`)
    .replace(/(https?:\/\/)[^\s:@/]+:[^\s@/]+@/gi, `$1${REDACTED}@`)
    .replace(/(https?:\/\/)[^\s:@/]+@/gi, `$1${REDACTED}@`)
    .replace(/(authorization:\s*(?:bearer|basic)\s+)\S+/gi, `$1${REDACTED}`)
    .replace(/\b(password|passwd|pwd|secret|token|apikey|api_key)=[^\s,;"']+/gi, `$1=${REDACTED}`);
}

/**
 * Redact secret Variable values inside a Komodo TOML export. Komodo renders
 * variables as `[[variable]]` blocks; a block flagged `is_secret = true` has
 * its `value = "…"` line masked. Needed because the export tools and the
 * resource-sync pending-diff surface raw TOML strings whose secret values are
 * inside the text, not a redactable object field — and Komodo Core only
 * redacts these for *non-admin* callers, which this admin-scoped server is not
 * (issue #160, findings C6-1 / C6-2).
 */
export function redactTomlSecrets(toml: string): string {
  const lines = toml.split("\n");
  // Index the block boundaries: a block runs from a `[[variable]]` header to
  // the line before the next TOML table header (`[` at column 0) or EOF.
  const isHeader = (l: string): boolean => /^\s*\[/.test(l);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\[\[variable\]\]\s*$/.test(lines[i] ?? "")) continue;
    let end = i + 1;
    while (end < lines.length && !isHeader(lines[end] ?? "")) end++;
    const block = lines.slice(i, end);
    if (!block.some((l) => /^\s*is_secret\s*=\s*true\s*$/.test(l))) continue;
    for (let j = i; j < end; j++) {
      const line = lines[j] ?? "";
      if (/^\s*value\s*=/.test(line)) {
        lines[j] = line.replace(/=.*/, `= "${REDACTED}"`);
      }
    }
  }
  return lines.join("\n");
}
