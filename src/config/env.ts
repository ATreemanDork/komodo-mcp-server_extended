/**
 * Application Environment Configuration
 *
 * Komodo-specific environment variables only.
 *
 * DEVIATION (scope decision, not an oversight): the reference version reads
 * a third credential tier from a framework-managed `[komodo]` config-file
 * section (TOML/YAML/JSON) via `registerConfigSection`/`getAppConfig`. That
 * whole config-file merge layer is dropped for this step — the deployment
 * target only uses env vars, and the plan's own Architecture notes treat
 * file-based config as a separate `config/file-config.ts` module for a
 * later pass, not tied to this step. `getKomodoCredentials()` here only
 * resolves the two tiers that remain: environment variables, then
 * `*_FILE` Docker-secret paths (env wins).
 *
 * @module config/env
 */

import { readFileSync } from "node:fs";
import { z } from "zod";
import { durationSchema } from "./duration.js";

// ============================================================================
// Schema
// ============================================================================

export const appEnvSchema = z.object({
  /** Komodo Core API URL */
  KOMODO_URL: z.string().url().optional(),

  /** Username for login authentication */
  KOMODO_USERNAME: z.string().optional(),

  /** Password for login authentication */
  KOMODO_PASSWORD: z.string().optional(),

  /** API Key for key-based authentication */
  KOMODO_API_KEY: z.string().optional(),

  /** API Secret for key-based authentication */
  KOMODO_API_SECRET: z.string().optional(),

  /** Pre-existing JWT token (e.g. obtained via OIDC, GitHub, or Google OAuth in browser) */
  KOMODO_JWT_TOKEN: z.string().optional(),

  /** Path to file containing the username (Docker secrets) */
  KOMODO_USERNAME_FILE: z.string().optional(),

  /** Path to file containing the password (Docker secrets) */
  KOMODO_PASSWORD_FILE: z.string().optional(),

  /** Path to file containing the API key (Docker secrets) */
  KOMODO_API_KEY_FILE: z.string().optional(),

  /** Path to file containing the API secret (Docker secrets) */
  KOMODO_API_SECRET_FILE: z.string().optional(),

  /** Path to file containing the JWT token (Docker secrets) */
  KOMODO_JWT_TOKEN_FILE: z.string().optional(),

  /** API request timeout. Accepts human-readable durations ('30s', '1m') or plain milliseconds. Default: '30s' */
  API_TIMEOUT_MS: durationSchema("30s").pipe(z.number().int().positive()),

  /** TTL for ephemeral info/inspect resources. Accepts durations ('15m') or ms. Default: '15m' */
  KOMODO_RESOURCE_TTL_INFO: durationSchema("15m").pipe(z.number().int().positive()),

  /** TTL for ephemeral log resources. Accepts durations ('2m') or ms. Default: '2m' */
  KOMODO_RESOURCE_TTL_LOGS: durationSchema("2m").pipe(z.number().int().positive()),

  /** Maximum number of dynamic resource entries kept in memory. Default: 1000 */
  KOMODO_RESOURCE_MAX_ENTRIES: z.coerce.number().int().positive().default(1000),

  /**
   * MCP transport to start. "stdio" and "http" (Streamable HTTP) are wired
   * up as of this build step — `src/index.ts` throws a clear "not
   * implemented yet" error for "https" until TLS wiring lands. Default: 'stdio'
   */
  MCP_TRANSPORT: z.enum(["stdio", "http", "https"]).default("stdio"),

  /** Host the Streamable HTTP transport binds to (only used when MCP_TRANSPORT=http|https). Default: '127.0.0.1' */
  MCP_BIND_HOST: z.string().default("127.0.0.1"),

  /** Port the Streamable HTTP transport binds to (only used when MCP_TRANSPORT=http|https). Default: 8000 */
  MCP_PORT: z.coerce.number().int().positive().default(8000),

  /**
   * Maximum number of concurrent Streamable HTTP MCP sessions kept in memory.
   * A request that would create a session beyond this cap is rejected with
   * HTTP 503. Default: 100
   */
  MCP_MAX_SESSIONS: z.coerce.number().int().positive().default(100),

  /**
   * Idle timeout for a Streamable HTTP MCP session. A session with no request
   * activity for longer than this is closed and its slot freed by a periodic
   * sweep, so abandoned sessions (client dropped without a DELETE) can't
   * exhaust MCP_MAX_SESSIONS. Accepts durations ('30m') or ms. Default: '30m'
   */
  MCP_SESSION_IDLE_MS: durationSchema("30m").pipe(z.number().int().positive()),

  /**
   * Optional signing key (any string) for guardrail dry-run/confirm tokens
   * (`src/guardrails/confirm.ts`). If unset, a random key is generated at
   * process boot — tokens then don't survive a restart, which is a safe
   * failure (forces a fresh dry-run call), not a security gap, since tokens
   * only need to live seconds-to-minutes. Set this only if you want a
   * confirm token to remain valid across a restart.
   */
  GUARDRAIL_HMAC_SECRET: z.string().optional(),
});

export type AppEnvConfig = z.infer<typeof appEnvSchema>;

// ============================================================================
// Parsed Config (once at startup)
// ============================================================================

export const config = appEnvSchema.parse(process.env);

// ============================================================================
// Runtime Credential Reader
// ============================================================================

export interface KomodoCredentials {
  url?: string | undefined;
  username?: string | undefined;
  password?: string | undefined;
  apiKey?: string | undefined;
  apiSecret?: string | undefined;
  jwtToken?: string | undefined;
}

/**
 * Read a secret value from a file path (Docker secrets pattern).
 * Returns undefined if the path is not set or the file cannot be read.
 */
function readSecretFile(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Docker secrets: path from trusted env var
    return readFileSync(filePath, "utf-8").trim();
  } catch {
    return undefined;
  }
}

/**
 * Read Komodo credentials at runtime.
 *
 * Sources (highest priority wins):
 * 1. Environment variables (process.env)
 * 2. Docker secret files (*_FILE env vars)
 *
 * (A third, file-based `[komodo]` config-section tier exists in the
 * reference implementation — dropped here, see module-level deviation note.)
 *
 * Important for Docker containers where env_file variables
 * are only available after container start.
 */
export function getKomodoCredentials(): KomodoCredentials {
  return {
    url: process.env["KOMODO_URL"],
    username: process.env["KOMODO_USERNAME"] ?? readSecretFile(process.env["KOMODO_USERNAME_FILE"]),
    password: process.env["KOMODO_PASSWORD"] ?? readSecretFile(process.env["KOMODO_PASSWORD_FILE"]),
    apiKey: process.env["KOMODO_API_KEY"] ?? readSecretFile(process.env["KOMODO_API_KEY_FILE"]),
    apiSecret: process.env["KOMODO_API_SECRET"] ?? readSecretFile(process.env["KOMODO_API_SECRET_FILE"]),
    jwtToken: process.env["KOMODO_JWT_TOKEN"] ?? readSecretFile(process.env["KOMODO_JWT_TOKEN_FILE"]),
  };
}
