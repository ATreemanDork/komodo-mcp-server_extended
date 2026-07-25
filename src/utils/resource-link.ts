/**
 * Resource Link Helper
 *
 * Bridges Komodo tool handlers to `src/mcp/resources.ts`'s ephemeral
 * resource registry. For session-bound clients, large payloads (inspect
 * output, full logs, compose files) are stored ephemerally and surfaced as
 * a `resource_link` content block plus a `resourceLink` field in the
 * structured payload. Stateless callers (stdio — no `sessionId`) and
 * explicit `inline_full=true` opt-outs continue to receive the full payload
 * inline.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/resource-link.ts) — calls our own
 * `mcp/resources.ts` registry instead of the reference's
 * `mcp-server-framework` `DynamicResourceRegistry`, and reuses
 * `resourceLinkSchema` (tools/schemas/shared.ts) for the return shape
 * instead of the framework's `ResourceLinkSpec` type.
 *
 * @module utils/resource-link
 */

import type { z } from "zod";
import { registerEphemeralResource } from "../mcp/resources.js";
import type { resourceLinkSchema } from "../tools/schemas/shared.js";

export type { ResourceCategory } from "../mcp/resources.js";
import type { ResourceCategory } from "../mcp/resources.js";

/**
 * Caller surface — only the part of `ToolHandlerExtra` we actually need.
 *
 * Keeping the dependency narrow lets unit tests stub the context with a
 * plain object instead of constructing a full `ToolHandlerExtra`. Declared
 * as its own interface (not `Pick<ToolHandlerExtra, "sessionId">`) so
 * `sessionId` explicitly allows `| undefined` — under this repo's
 * `exactOptionalPropertyTypes`, a `Pick` of the SDK's own (narrower)
 * optional property forced every caller to conditionally spread
 * (`sessionId !== undefined ? { sessionId } : {}`) instead of just passing
 * `{ sessionId }` straight from a destructured handler `extra`.
 */
export interface ResourceLinkContext {
  readonly sessionId?: string | undefined;
}

export type ResourceLinkSpec = z.infer<typeof resourceLinkSchema>;

/** Options for {@link tryRegisterResource}. */
export interface RegisterResourceOptions {
  /** Tool call context — `sessionId` decides whether registration is possible. */
  readonly ctx: ResourceLinkContext;
  /** Logical category (URI path segment). */
  readonly category: ResourceCategory;
  /** Display name surfaced on the link (e.g. resource id, container name). */
  readonly name: string;
  /** MIME type of the stored content (e.g. `application/json`, `text/plain`). */
  readonly mimeType: string;
  /** Payload to register. */
  readonly content: string | Uint8Array;
  /** TTL in milliseconds. */
  readonly ttlMs: number;
  /** Inline-full opt-out from the tool's input arguments. */
  readonly inlineFull?: boolean | undefined;
  /** Optional short description rendered alongside the link. */
  readonly description?: string;
}

/**
 * Register `content` in the ephemeral resource registry and return a link
 * spec, or `null` if registration must be skipped (stateless caller or
 * explicit inline-full opt-out).
 *
 * Callers use the return value to decide between two output shapes:
 * - link spec → emit summary + resource link, drop the full payload from the body
 * - `null`    → inline the full payload as before
 *
 * Registration failures are swallowed (logged-and-fallback) — the caller
 * always falls back to inlining so that a registry hiccup never breaks
 * the tool.
 */
export function tryRegisterResource(opts: RegisterResourceOptions): ResourceLinkSpec | null {
  if (opts.inlineFull) return null;
  const sessionId = opts.ctx.sessionId;
  if (!sessionId) return null;

  try {
    const { uri } = registerEphemeralResource({
      sessionId,
      category: opts.category,
      mimeType: opts.mimeType,
      content: opts.content,
      ttlMs: opts.ttlMs,
    });

    return {
      uri,
      name: opts.name,
      mimeType: opts.mimeType,
      ...(opts.description !== undefined && { description: opts.description }),
    };
  } catch {
    return null;
  }
}
