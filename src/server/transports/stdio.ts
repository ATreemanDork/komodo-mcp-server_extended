/**
 * Stdio Transport
 *
 * Thin wrapper wiring `StdioServerTransport` (from
 * `@modelcontextprotocol/sdk/server/stdio.js`) into a `KomodoMcpServer`
 * built by `create-server.ts`.
 *
 * @module server/transports/stdio
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { KomodoMcpServer } from "../create-server.js";

/**
 * Connect `mcpServer` to a new stdio transport (reads stdin / writes stdout —
 * stdout is reserved for JSON-RPC framing, which is why `server/logging.ts`
 * writes to stderr instead).
 */
export async function startStdioTransport(mcpServer: KomodoMcpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await mcpServer.start(transport);
}
