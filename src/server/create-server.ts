/**
 * MCP Server Factory
 *
 * Builds the real `McpServer` (from `@modelcontextprotocol/sdk`), registers
 * every tool descriptor from `src/mcp/registry.ts`, and exposes a small
 * `start()`/`stop()` lifecycle. This — plus `src/mcp/define-tool.ts` —
 * replaces the reference repo's opaque `mcp-server-framework` bootstrap.
 *
 * @module server/create-server
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { initializeKomodoClientFromEnv } from "../client.js";
import { SERVER_NAME, SERVER_VERSION } from "../config/index.js";
import { getRegisteredTools } from "../mcp/registry.js";
import { EPHEMERAL_URI_TEMPLATE, readEphemeralResource, startResourceSweep } from "../mcp/resources.js";
import { logger as baseLogger } from "./logging.js";
// Imported for its registration side effect: every tool file's top-level
// `registerToolDefinition()` call runs here, populating the registry below
// is enumerated. See src/tools/index.ts for the list of ported tool files.
import "../tools/index.js";

const logger = baseLogger.child({ component: "create-server" });

export interface KomodoMcpServer {
  /** The underlying SDK server instance — useful for advanced/test access. */
  readonly server: McpServer;
  /** Initializes the Komodo client from env, then connects the given transport. */
  start(transport: Transport): Promise<void>;
  /** Closes the server (and its transport). Does not touch the Komodo connection. */
  stop(): Promise<void>;
}

/**
 * Build a fully-configured `McpServer` with every registered tool wired up.
 * Does not connect a transport — call `start(transport)` for that.
 */
export function createServer(): KomodoMcpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: { listChanged: true }, resources: {}, logging: {} } },
  );

  const tools = getRegisteredTools();
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
        ...(tool._meta ? { _meta: tool._meta } : {}),
      },
      tool.handler,
    );
  }
  logger.info("Registered %d tool(s): %s", tools.length, tools.map((t) => t.name).join(", "));

  // Ephemeral resource-link template — session-isolated, TTL-bound reads
  // for large tool payloads registered via src/utils/resource-link.ts.
  // `list: undefined` because entries are opaque, single-use links handed
  // out by tool calls, not something clients should browse.
  server.registerResource(
    "ephemeral",
    new ResourceTemplate(EPHEMERAL_URI_TEMPLATE, { list: undefined }),
    { description: "Session-scoped ephemeral resource (large tool payload, TTL-bound)" },
    (uri, _variables, extra) => {
      const resource = readEphemeralResource(uri.href, extra.sessionId);
      if (!resource) {
        throw new McpError(ErrorCode.InvalidParams, `Resource not found or expired: ${uri.href}`);
      }
      if (typeof resource.content === "string") {
        return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.content }] };
      }
      return {
        contents: [
          { uri: resource.uri, mimeType: resource.mimeType, blob: Buffer.from(resource.content).toString("base64") },
        ],
      };
    },
  );
  startResourceSweep();

  return {
    server,
    async start(transport: Transport): Promise<void> {
      await initializeKomodoClientFromEnv();
      await server.connect(transport);
      logger.info("MCP server connected");
    },
    async stop(): Promise<void> {
      await server.close();
      logger.info("MCP server closed");
    },
  };
}
