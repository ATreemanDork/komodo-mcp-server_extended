#!/usr/bin/env node
/**
 * Entry Point
 *
 * Builds the MCP server, starts the configured transport, and wires up
 * graceful shutdown. `stdio` and `http` (Streamable HTTP) are implemented —
 * `https` (TLS) is a later step, see the throw below.
 *
 * @module index
 */

import { config } from "./config/index.js";
import { komodoConnection } from "./client.js";
import { createServer } from "./server/create-server.js";
import { startStdioTransport } from "./server/transports/stdio.js";
import { startHttpTransport } from "./server/transports/http.js";
import { logger as baseLogger } from "./server/logging.js";

const logger = baseLogger.child({ component: "index" });

/** Installs SIGINT/SIGTERM handlers that run `cleanup` once, then exit. */
function installShutdownHandlers(cleanup: () => Promise<void>): void {
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Received %s — shutting down", signal);
    void (async () => {
      await cleanup();
      process.exit(0);
    })();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  if (config.MCP_TRANSPORT === "https") {
    throw new Error(
      'MCP_TRANSPORT="https" is not implemented yet — TLS wiring for the Streamable HTTP transport is a later build step. Use "http" (behind a TLS-terminating reverse proxy) or "stdio" instead.',
    );
  }

  if (config.MCP_TRANSPORT === "http") {
    const httpTransport = await startHttpTransport();
    installShutdownHandlers(async () => {
      komodoConnection.stopMonitoring();
      await httpTransport.close();
    });
    return;
  }

  const mcpServer = createServer();
  await startStdioTransport(mcpServer);
  installShutdownHandlers(async () => {
    komodoConnection.stopMonitoring();
    await mcpServer.stop();
  });
}

main().catch((error: unknown) => {
  logger.error("Fatal error during startup: %s", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
