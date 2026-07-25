/**
 * Application Logger
 *
 * Minimal pino-based logger replacing mcp-server-framework's logger
 * subsystem (which also does file writing, secret scrubbing, injection
 * guarding, text/json formatting — none of that is ported here; this is a
 * deliberately small stand-in, not an equivalent).
 *
 * Exposes the same call shape used throughout the ported code:
 * `.trace/.debug/.info/.warn/.error(msg, ...args)` with `%s`-style
 * interpolation (handled natively by pino via Node's `util.format` when
 * extra args follow a string message) and `.child({ component })` for
 * per-module child loggers.
 *
 * Logs are written to stderr rather than stdout: a later build step wires
 * up the MCP stdio transport, which reserves stdout for JSON-RPC framing —
 * writing logs there would corrupt the protocol stream.
 *
 * @module server/logging
 */

import pino from "pino";

const level = process.env["LOG_LEVEL"] ?? "info";

export const logger: pino.Logger = pino({ level }, pino.destination(2));
