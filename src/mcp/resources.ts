/**
 * Ephemeral Resource Registry
 *
 * Session-scoped, TTL-bound storage for large tool-call payloads (inspect
 * output, full logs, compose files) that would otherwise blow past a
 * reasonable inline response size. Tool handlers register content here via
 * `src/utils/resource-link.ts`'s `tryRegisterResource()` and get back an
 * `ephemeral://<category>/<uuid>` URI; MCP clients read it back through the
 * `McpServer.registerResource()` template wired up in
 * `src/server/create-server.ts`.
 *
 * New construction, not a port — the reference repo's equivalent wraps
 * `mcp-server-framework`'s `DynamicResourceRegistry`, which has no local
 * equivalent. This module owns storage, session isolation, and expiry only;
 * it never touches the SDK's `McpServer` instance directly — the same split
 * `mcp/registry.ts` uses for tools (this module is the registry,
 * `create-server.ts` is the only place that calls a real
 * `McpServer.register*()` method).
 *
 * @module mcp/resources
 */

import { randomUUID } from "node:crypto";

/** Logical category for a registered resource (segments the URI path). */
export type ResourceCategory = "info" | "inspect" | "logs" | "compose";

interface ResourceEntry {
  readonly sessionId: string;
  readonly mimeType: string;
  readonly content: string | Uint8Array;
  readonly expiresAt: number;
}

export interface RegisterEphemeralResourceOptions {
  /** Owning session — only reads from the same session can retrieve this content. */
  readonly sessionId: string;
  /** Logical category (URI path segment). */
  readonly category: ResourceCategory;
  /** MIME type of the stored content (e.g. `application/json`, `text/plain`). */
  readonly mimeType: string;
  /** Payload to register. */
  readonly content: string | Uint8Array;
  /** TTL in milliseconds. */
  readonly ttlMs: number;
}

export interface EphemeralResourceContents {
  readonly uri: string;
  readonly mimeType: string;
  readonly content: string | Uint8Array;
}

/** URI scheme for every resource registered by this module. */
export const EPHEMERAL_URI_SCHEME = "ephemeral";

/** URI template pattern for the resource registered in create-server.ts. */
export const EPHEMERAL_URI_TEMPLATE = `${EPHEMERAL_URI_SCHEME}://{category}/{id}`;

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

const entries = new Map<string, ResourceEntry>();

let sweepTimer: NodeJS.Timeout | null = null;

function sweep(): void {
  const now = Date.now();
  for (const [uri, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(uri);
  }
}

/**
 * Starts the periodic expiry sweep. Idempotent — a second call is a no-op
 * until `stopResourceSweep()` runs. `unref()`s the timer so it never keeps
 * the process alive on its own.
 */
export function startResourceSweep(intervalMs = DEFAULT_SWEEP_INTERVAL_MS): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweep, intervalMs);
  sweepTimer.unref();
}

/** Stops the periodic sweep. */
export function stopResourceSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/** Registers ephemeral content and returns its resource URI. */
export function registerEphemeralResource(opts: RegisterEphemeralResourceOptions): { uri: string } {
  const uri = `${EPHEMERAL_URI_SCHEME}://${opts.category}/${randomUUID()}`;
  entries.set(uri, {
    sessionId: opts.sessionId,
    mimeType: opts.mimeType,
    content: opts.content,
    expiresAt: Date.now() + opts.ttlMs,
  });
  return { uri };
}

/**
 * Reads back ephemeral content, enforcing session isolation and expiry
 * (lazily, in addition to the periodic sweep — an entry can be read exactly
 * up to its expiry even if the sweep hasn't run yet, and never after).
 *
 * Returns `undefined` uniformly for "never existed", "expired", and "wrong
 * session" — callers should surface a generic not-found error, never a hint
 * about which case applied (avoids leaking cross-session existence).
 */
export function readEphemeralResource(
  uri: string,
  sessionId: string | undefined,
): EphemeralResourceContents | undefined {
  const entry = entries.get(uri);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(uri);
    return undefined;
  }
  if (!sessionId || entry.sessionId !== sessionId) return undefined;
  return { uri, mimeType: entry.mimeType, content: entry.content };
}

/** Test-only — clears all registered entries and stops the sweep. */
export function clearEphemeralResources(): void {
  entries.clear();
  stopResourceSweep();
}
