/**
 * Streamable HTTP Transport
 *
 * Wires the SDK's `StreamableHTTPServerTransport` into an Express app,
 * following the standard stateful-session pattern from the SDK's own docs:
 * one `StreamableHTTPServerTransport` (and, per the note below, one
 * `McpServer`) per session, keyed by the `mcp-session-id` header.
 *
 * DEVIATION from the plan's literal wording ("connect it to the McpServer
 * instance"): the SDK's `Protocol.connect()` throws if the same `Server`/
 * `McpServer` instance is connected to a second transport while already
 * connected to a first ("Already connected to a transport...") — see
 * `node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js`.
 * A single shared `McpServer` therefore cannot serve more than one
 * concurrent HTTP session. Each session gets its own `createServer()`
 * instance (tools are re-registered from the same in-process registry —
 * cheap, no behavior difference) connected to that session's own
 * transport. The Komodo connection itself is still process-global and
 * initialized exactly once (in `startHttpTransport`, not per session) —
 * `komodoConnection` is a module-level singleton in `client.ts`, so every
 * per-session `McpServer`'s tool handlers share the same underlying Komodo
 * client regardless of how many sessions exist.
 *
 * @module server/transports/http
 */

import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { config } from "../../config/index.js";
import { initializeKomodoClientFromEnv, komodoConnection } from "../../client.js";
import { createServer as createMcpServer } from "../create-server.js";
import { logger as baseLogger } from "../logging.js";

const logger = baseLogger.child({ component: "http-transport" });

const MCP_SESSION_ID_HEADER = "mcp-session-id";

/** JSON-RPC error envelope for transport-level rejections (no request id available). */
function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

function getSessionId(req: Request): string | undefined {
  const header = req.headers[MCP_SESSION_ID_HEADER];
  return typeof header === "string" ? header : undefined;
}

/**
 * Build the Express app exposing the Streamable HTTP MCP endpoint plus
 * liveness/readiness probes. Pure factory — does not listen on a port and
 * does not touch the Komodo connection; call `startHttpTransport()` for the
 * full production entrypoint (Komodo init + listen + graceful close).
 */
export function createHttpApp(): Express {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  // Last-activity timestamp per session, for idle eviction (below). Abandoned
  // sessions (client dropped without a DELETE) would otherwise hold an
  // MCP_MAX_SESSIONS slot forever.
  const lastSeen = new Map<string, number>();

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  // No CORS: /mcp is server-to-server (behind the LiteLLM/gateway), never
  // fetched from a browser origin, so a reflecting `cors()` only widened the
  // surface. Dropped rather than allowlisted — there is no browser client to
  // allow.
  app.use(express.json());

  // Malformed JSON bodies should get a JSON-RPC-shaped 400, not Express's
  // default HTML error page.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && "status" in err && "body" in err) {
      jsonRpcError(res, 400, -32700, "Parse error: invalid JSON body");
      return;
    }
    next(err);
  });

  // Liveness: process is up. Never depends on Komodo connectivity.
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Readiness: reflects the Komodo connection state.
  app.get("/ready", (_req, res) => {
    if (komodoConnection.connected) {
      res.status(200).json({ status: "ready" });
    } else {
      res.status(503).json({ status: "not_ready" });
    }
  });

  const mcpLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Key by MCP session, not IP: behind a single gateway hop every request
    // carries the gateway's IP, so an IP key would share ONE bucket across all
    // callers. The initialize request (no session id yet) falls back to IP.
    keyGenerator: (req) => getSessionId(req) ?? req.ip ?? "unknown",
  });
  app.use("/mcp", mcpLimiter);

  // Stamp last-activity for idle eviction on every session-bearing /mcp call.
  app.use("/mcp", (req, _res, next) => {
    const sid = getSessionId(req);
    if (sid) lastSeen.set(sid, Date.now());
    next();
  });

  // Periodically evict sessions idle past the configured timeout, freeing their
  // MCP_MAX_SESSIONS slot. unref()'d so it never keeps the process alive.
  const idleSweep = setInterval(
    () => {
      const now = Date.now();
      for (const [sid, transport] of sessions) {
        if (now - (lastSeen.get(sid) ?? now) > config.MCP_SESSION_IDLE_MS) {
          void transport.close();
          sessions.delete(sid);
          logger.debug("Evicted idle MCP session: %s (%d active)", sid, sessions.size);
        }
      }
      // Reconcile: drop last-seen entries for sessions closed by any path
      // (explicit DELETE, transport onclose) so the map can't grow unbounded.
      for (const sid of lastSeen.keys()) if (!sessions.has(sid)) lastSeen.delete(sid);
    },
    Math.min(config.MCP_SESSION_IDLE_MS, 60_000),
  );
  idleSweep.unref();

  app.post("/mcp", (req, res) => {
    void handlePost(req, res, sessions);
  });

  app.get("/mcp", (req, res) => {
    void handleSessionRequest(req, res, sessions);
  });

  app.delete("/mcp", (req, res) => {
    void handleDelete(req, res, sessions);
  });

  return app;
}

async function handlePost(
  req: Request,
  res: Response,
  sessions: Map<string, StreamableHTTPServerTransport>,
): Promise<void> {
  const sessionId = getSessionId(req);

  let transport: StreamableHTTPServerTransport;

  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (!existing) {
      jsonRpcError(res, 404, -32001, `Session not found: "${sessionId}"`);
      return;
    }
    transport = existing;
  } else if (isInitializeRequest(req.body)) {
    if (sessions.size >= config.MCP_MAX_SESSIONS) {
      jsonRpcError(res, 503, -32000, "Server busy: maximum concurrent MCP session count reached");
      return;
    }

    const mcpServer = createMcpServer();
    const newTransport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, newTransport);
        logger.debug("MCP session initialized: %s (%d active)", sid, sessions.size);
      },
      onsessionclosed: (sid) => {
        sessions.delete(sid);
        logger.debug("MCP session closed: %s (%d active)", sid, sessions.size);
      },
    });
    newTransport.onclose = () => {
      if (newTransport.sessionId) sessions.delete(newTransport.sessionId);
    };

    // Cast note: `StreamableHTTPServerTransport.onclose` is declared as a
    // get/set accessor pair typed `(() => void) | undefined` (see
    // node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.d.ts),
    // while `Transport.onclose` is a plain optional property typed
    // `() => void` (no explicit `| undefined`). Under this project's
    // `exactOptionalPropertyTypes: true`, TS treats those as incompatible
    // even though the class is a real, working `Transport` implementation
    // (`StdioServerTransport`, by contrast, declares `onclose` as a plain
    // optional property and doesn't hit this). This is an SDK-typing rough
    // edge, not a real behavioral mismatch — `connect()` genuinely accepts
    // this transport at runtime (see the stdio transport's near-identical
    // call, which needs no cast only because of that typing difference).
    await mcpServer.server.connect(newTransport as unknown as Transport);
    transport = newTransport;
  } else {
    jsonRpcError(
      res,
      400,
      -32000,
      "Bad Request: no valid session ID provided and request is not an initialize request",
    );
    return;
  }

  await transport.handleRequest(req, res, req.body);
}

async function handleSessionRequest(
  req: Request,
  res: Response,
  sessions: Map<string, StreamableHTTPServerTransport>,
): Promise<void> {
  const sessionId = getSessionId(req);
  const transport = sessionId ? sessions.get(sessionId) : undefined;
  if (!transport) {
    jsonRpcError(res, 404, -32001, `Session not found: "${sessionId ?? "<missing>"}"`);
    return;
  }
  await transport.handleRequest(req, res);
}

async function handleDelete(
  req: Request,
  res: Response,
  sessions: Map<string, StreamableHTTPServerTransport>,
): Promise<void> {
  const sessionId = getSessionId(req);
  if (!sessionId) {
    jsonRpcError(res, 404, -32001, "Session not found: <missing>");
    return;
  }
  const transport = sessions.get(sessionId);
  if (!transport) {
    jsonRpcError(res, 404, -32001, `Session not found: "${sessionId}"`);
    return;
  }
  await transport.handleRequest(req, res, req.body);
  // Belt-and-suspenders: the transport's onsessionclosed/onclose callbacks
  // already remove the entry, but a stale session must never remain
  // reusable even if that callback timing ever changes upstream.
  sessions.delete(sessionId);
}

export interface HttpTransportHandle {
  readonly app: Express;
  readonly server: HttpServer;
  /** The actual bound port (relevant when starting with port 0 / an OS-assigned port). */
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Production entrypoint: initializes the Komodo connection once, builds the
 * Express app, and listens on `MCP_BIND_HOST`/`MCP_PORT` (overridable for
 * tests, e.g. `{ port: 0 }` to get an OS-assigned ephemeral port).
 */
export async function startHttpTransport(overrides?: { host?: string; port?: number }): Promise<HttpTransportHandle> {
  await initializeKomodoClientFromEnv();

  const app = createHttpApp();
  const host = overrides?.host ?? config.MCP_BIND_HOST;
  const port = overrides?.port ?? config.MCP_PORT;

  const server = await new Promise<HttpServer>((resolve, reject) => {
    const listener: HttpServer = app.listen(port, host);
    listener.once("listening", () => {
      resolve(listener);
    });
    listener.once("error", (err: Error) => {
      reject(err);
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;

  logger.info("Streamable HTTP transport listening on %s:%d", host, actualPort);

  return {
    app,
    server,
    port: actualPort,
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
