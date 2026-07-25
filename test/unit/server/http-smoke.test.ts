/**
 * HTTP Transport Smoke Test
 *
 * Same mocking approach as `stdio-smoke.test.ts` (mock `komodoConnection`/
 * `initializeKomodoClientFromEnv` so `requireClient()` resolves to a fake
 * client), but driving the *real* Express app over a real local TCP socket
 * (`startHttpTransport({ host: "127.0.0.1", port: 0 })`, OS-assigned port)
 * using the SDK's `StreamableHTTPClientTransport` as the client side —
 * exercising the actual HTTP session-management code in
 * `src/server/transports/http.ts`, not an in-memory transport pair.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { HttpTransportHandle } from "../../../src/server/transports/http.js";

const mockServerListItem = {
  id: "srv-1",
  name: "test-server",
  info: { state: "Ok", version: "1.18.0", region: "test-region" },
};

const readMock = vi.fn(async (type: string) => {
  if (type === "ListServers") return [mockServerListItem];
  throw new Error(`http-smoke test: unexpected read type "${type}"`);
});

// Mutable so the /ready assertions below can flip it mid-test.
let mockConnected = true;

vi.mock("../../../src/client.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/client.js")>("../../../src/client.js");
  return {
    ...actual,
    initializeKomodoClientFromEnv: vi.fn(async () => {}),
    komodoConnection: {
      getClient: () => ({ client: { read: readMock } }),
      stopMonitoring: vi.fn(),
      get connected() {
        return mockConnected;
      },
    },
  };
});

describe("http transport smoke test (real network, ephemeral port)", () => {
  let handle: HttpTransportHandle | undefined;

  afterEach(async () => {
    mockConnected = true;
    if (handle) {
      await handle.close();
      handle = undefined;
    }
  });

  it("creates a session, round-trips tools/list + tools/call, and reports health/ready", async () => {
    const { startHttpTransport } = await import("../../../src/server/transports/http.js");
    handle = await startHttpTransport({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    // --- /health: always 200, regardless of Komodo connectivity ---
    const healthRes = await fetch(`${baseUrl}/health`);
    expect(healthRes.status).toBe(200);

    // --- /ready: reflects the mocked connection state ---
    mockConnected = true;
    const readyOkRes = await fetch(`${baseUrl}/ready`);
    expect(readyOkRes.status).toBe(200);

    mockConnected = false;
    const readyDownRes = await fetch(`${baseUrl}/ready`);
    expect(readyDownRes.status).toBe(503);
    mockConnected = true;

    // --- Session creation via first POST /mcp (no mcp-session-id header) ---
    const client = new Client({ name: "http-smoke-test-client", version: "0.0.0" });
    const clientTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await client.connect(clientTransport);

    expect(clientTransport.sessionId).toBeDefined();
    const sessionId = clientTransport.sessionId;
    if (!sessionId) throw new Error("expected a session id after connecting");

    try {
      // --- tools/list ---
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("komodo_server_list");
      const serverListTool = tools.find((tool) => tool.name === "komodo_server_list");
      expect(serverListTool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });

      // --- tools/call round-trip against the mock ---
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
      // --- DELETE /mcp: terminate the session ---
      await clientTransport.terminateSession();
      await client.close().catch(() => {});
    }

    // --- Reusing the now-stale session id must be rejected, not silently
    // accepted and not silently upgraded into a new session. ---
    const staleResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list", params: {} }),
    });
    expect(staleResponse.status).toBe(404);
    const staleBody: unknown = await staleResponse.json();
    expect(staleBody).toMatchObject({ jsonrpc: "2.0", error: expect.objectContaining({ code: expect.any(Number) }) });
  });
});
