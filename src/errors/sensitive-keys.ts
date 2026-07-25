/**
 * Sensitive Key Detection
 *
 * Ported verbatim from `mcp-server-framework`'s `utils/sensitive-keys.js`
 * (v1.1.2) — used by `ValidationError`'s value redaction so a validation
 * error's `context.value` never echoes back a credential-shaped field. No
 * framework dependency of its own; pure data + string matching.
 *
 * @module errors/sensitive-keys
 */

export const SENSITIVE_KEYS = [
  "password",
  "passwd",
  "apiKey",
  "api_key",
  "apiSecret",
  "api_secret",
  "token",
  "secret",
  "authorization",
  "auth_token",
  "access_token",
  "refresh_token",
  "id_token",
  "jwt",
  "bearer",
  "private_key",
  "privateKey",
  "secret_key",
  "secretKey",
  "passphrase",
  "key",
  "credential",
  "sessionSecret",
  "session_secret",
  "sessionToken",
  "session_token",
  "oauth_token",
  "oauth_secret",
  "oauth_code",
  "client_secret",
  "clientSecret",
] as const;

export const SENSITIVE_KEY_BLOCKLIST = [
  "tokenizer",
  "tokenize",
  "tokenization",
  "keyboard",
  "keyframe",
  "keynote",
  "monkey",
  "passthrough",
  "passenger",
  "passage",
] as const;

const SEGMENT_SEPARATORS = /[_\-.\s]+/;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BLOCKLIST_PATTERNS = SENSITIVE_KEY_BLOCKLIST.map(
  (word) => new RegExp(`(?:^|[_\\-.\\s])${escapeRegex(word.toLowerCase())}(?:$|[_\\-.\\s])`, "i"),
);

export function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  const hasSensitiveMatch = SENSITIVE_KEYS.some((sensitiveKey) => lowerKey.includes(sensitiveKey.toLowerCase()));
  if (!hasSensitiveMatch) return false;

  for (const blocked of SENSITIVE_KEY_BLOCKLIST) {
    if (lowerKey === blocked.toLowerCase()) return false;
  }

  const segments = lowerKey.split(SEGMENT_SEPARATORS).filter(Boolean);
  if (segments.length > 1) {
    return segments.some((segment) => {
      const isSensitive = SENSITIVE_KEYS.some((sk) => segment.includes(sk.toLowerCase()));
      if (!isSensitive) return false;
      const isBlocked = SENSITIVE_KEY_BLOCKLIST.some((blocked) => segment === blocked.toLowerCase());
      return isSensitive && !isBlocked;
    });
  }

  return !BLOCKLIST_PATTERNS.some((pattern) => pattern.test(lowerKey));
}
