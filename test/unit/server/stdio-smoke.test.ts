/**
 * Transport Smoke Test
 *
 * Spins up the real `McpServer` (via `createServer()`) and a real SDK
 * `Client`, connected through the SDK's `InMemoryTransport` linked pair —
 * no stdio process, no real Komodo instance. `komodoConnection`/
 * `initializeKomodoClientFromEnv` are mocked so `requireClient()` resolves
 * to a fake client whose `.read("ListServers", {})` returns canned data.
 *
 * Asserts `tools/list` includes `komodo_server_list` (the tool this smoke
 * test exercises — the full list grows as more domains are ported, so this
 * intentionally checks presence, not the exact set), and a mocked
 * `tools/call` round-trips the expected structured payload.
 */

import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";

const mockServerListItem = {
  id: "srv-1",
  name: "test-server",
  info: { state: "Ok", version: "1.18.0", region: "test-region" },
};

const readMock = vi.fn(async (type: string) => {
  if (type === "ListServers") return [mockServerListItem];
  throw new Error(`stdio-smoke test: unexpected read type "${type}"`);
});

vi.mock("../../../src/client.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/client.js")>("../../../src/client.js");
  return {
    ...actual,
    initializeKomodoClientFromEnv: vi.fn(async () => {}),
    komodoConnection: {
      getClient: () => ({ client: { read: readMock } }),
      stopMonitoring: vi.fn(),
    },
  };
});

describe("stdio transport smoke test (in-memory transport pair)", () => {
  it("exposes komodo_server_list and round-trips a mocked tools/call", async () => {
    const { createServer } = await import("../../../src/server/create-server.js");
    const mcpServer = createServer();

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "stdio-smoke-test-client", version: "0.0.0" });

    await Promise.all([mcpServer.start(serverTransport), client.connect(clientTransport)]);

    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("komodo_server_list");
      const serverListTool = tools.find((tool) => tool.name === "komodo_server_list");
      expect(serverListTool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });

      const result = await client.callTool({ name: "komodo_server_list", arguments: {} });
      expect(result.isError).toBeFalsy();

      const content = result.content as TextContent[];
      expect(content).toHaveLength(1);
      expect(content[0]?.type).toBe("text");
      expect(content[0]?.text).toContain("test-server");

      expect(result.structuredContent).toEqual({
        items: [{ id: "srv-1", name: "test-server", state: "Ok", version: "1.18.0", region: "test-region" }],
        page: { total: 1 },
      });

      expect(readMock).toHaveBeenCalledWith("ListServers", {});
    } finally {
      await client.close();
      await mcpServer.stop();
    }
  });
});
