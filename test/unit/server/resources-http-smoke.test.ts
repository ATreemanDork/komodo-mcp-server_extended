/**
 * Ephemeral Resource — HTTP transport smoke test
 *
 * Proves the actual `server.registerResource()` wiring in create-server.ts
 * (URI template match, session extraction from `extra.sessionId`, the
 * not-found `McpError`) over a real local TCP socket with the real SDK
 * `Client` — not just the registry logic in `mcp/resources.test.ts`.
 *
 * Two independent HTTP sessions connect to the same server. Content
 * registered under session A's id must be readable by session A and
 * rejected for session B, proving the session-isolation guarantee the
 * resource-link design depends on.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { HttpTransportHandle } from "../../../src/server/transports/http.js";
import { registerEphemeralResource } from "../../../src/mcp/resources.js";

vi.mock("../../../src/client.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/client.js")>("../../../src/client.js");
  return {
    ...actual,
    initializeKomodoClientFromEnv: vi.fn(async () => {}),
    komodoConnection: {
      getClient: () => null,
      stopMonitoring: vi.fn(),
      connected: false,
    },
  };
});

async function connectSession(baseUrl: string): Promise<{ client: Client; sessionId: string }> {
  const client = new Client({ name: "resources-smoke-test-client", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  await client.connect(transport);
  const sessionId = transport.sessionId;
  if (!sessionId) throw new Error("expected a session id after connecting");
  return { client, sessionId };
}

describe("ephemeral resource HTTP smoke test (real network, ephemeral port)", () => {
  let handle: HttpTransportHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = undefined;
    }
  });

  it("round-trips text content for the owning session and rejects a different session", async () => {
    const { startHttpTransport } = await import("../../../src/server/transports/http.js");
    handle = await startHttpTransport({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    const sessionA = await connectSession(baseUrl);
    const sessionB = await connectSession(baseUrl);

    try {
      const { uri } = registerEphemeralResource({
        sessionId: sessionA.sessionId,
        category: "logs",
        mimeType: "text/plain",
        content: "container log line 1\ncontainer log line 2",
        ttlMs: 60_000,
      });

      const result = await sessionA.client.readResource({ uri });
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toMatchObject({
        uri,
        mimeType: "text/plain",
        text: "container log line 1\ncontainer log line 2",
      });

      await expect(sessionB.client.readResource({ uri })).rejects.toThrow();
    } finally {
      await sessionA.client.close().catch(() => {});
      await sessionB.client.close().catch(() => {});
    }
  });

  it("round-trips binary content as base64 blob", async () => {
    const { startHttpTransport } = await import("../../../src/server/transports/http.js");
    handle = await startHttpTransport({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    const sessionA = await connectSession(baseUrl);

    try {
      const bytes = new Uint8Array([1, 2, 3, 4, 250, 251, 252]);
      const { uri } = registerEphemeralResource({
        sessionId: sessionA.sessionId,
        category: "inspect",
        mimeType: "application/octet-stream",
        content: bytes,
        ttlMs: 60_000,
      });

      const result = await sessionA.client.readResource({ uri });
      expect(result.contents).toHaveLength(1);
      const [content] = result.contents;
      expect(content).toMatchObject({ uri, mimeType: "application/octet-stream" });
      const blob = (content as { blob: string }).blob;
      expect(Buffer.from(blob, "base64")).toEqual(Buffer.from(bytes));
    } finally {
      await sessionA.client.close().catch(() => {});
    }
  });

  it("rejects an unknown uri", async () => {
    const { startHttpTransport } = await import("../../../src/server/transports/http.js");
    handle = await startHttpTransport({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://127.0.0.1:${String(handle.port)}`;

    const sessionA = await connectSession(baseUrl);

    try {
      await expect(sessionA.client.readResource({ uri: "ephemeral://logs/does-not-exist" })).rejects.toThrow();
    } finally {
      await sessionA.client.close().catch(() => {});
    }
  });
});
