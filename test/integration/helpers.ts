/**
 * Integration Test Harness
 *
 * Shared setup for `test/integration/**` — real Komodo connection, real
 * `McpServer`, connected to a real SDK `Client` via an in-memory transport
 * pair (same pattern as `test/unit/server/stdio-smoke.test.ts`, minus the
 * `client.js` mock). Every domain file calls `startIntegrationClient()`
 * once in `beforeAll` and `stop()` in `afterAll`.
 *
 * Resource naming: every disposable resource created by these tests is
 * prefixed `kmcp-itest-<domain>-` plus a short random suffix, so repeated
 * or (accidentally) concurrent runs never collide, and a stray leftover is
 * immediately recognizable as test debris on the target Komodo instance.
 *
 * @module test/integration/helpers
 */

import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Object id of a Komodo Server the integration tests target, taken from
 * `KOMODO_TEST_SERVER_ID`. Server-scoped suites skip themselves when this is
 * unset (see each suite's `describe.skipIf`). Never hard-code a real id here.
 */
export const TEST_SERVER_ID = process.env["KOMODO_TEST_SERVER_ID"] ?? "";

export function uniqueName(domain: string): string {
  return `kmcp-itest-${domain}-${randomUUID().slice(0, 8)}`;
}

export interface IntegrationClient {
  readonly client: Client;
  stop(): Promise<void>;
}

/**
 * Boot a real `McpServer` (real Komodo connection via `.env`) and connect a
 * real SDK `Client` to it in-process. Throws loudly if `KOMODO_URL` isn't
 * configured — callers should `describe.skipIf(!process.env["KOMODO_URL"])`
 * around any suite that needs this, not swallow the failure.
 */
export async function startIntegrationClient(): Promise<IntegrationClient> {
  const { initializeKomodoClientFromEnv } = await import("../../src/client.js");
  await initializeKomodoClientFromEnv();
  const { createServer } = await import("../../src/server/create-server.js");
  const mcpServer = createServer();

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "integration-test-client", version: "0.0.0" });
  await Promise.all([mcpServer.start(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    stop: async () => {
      await client.close();
      await mcpServer.stop();
    },
  };
}

export interface CallOutcome {
  readonly isError: boolean;
  readonly text: string;
  readonly structuredContent: Record<string, unknown> | undefined;
}

export async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallOutcome> {
  const res: CallToolResult = await client.callTool({ name, arguments: args });
  const textBlock = res.content?.find((c): c is { type: "text"; text: string } => c.type === "text");
  return {
    isError: Boolean(res.isError),
    text: textBlock?.text ?? "",
    structuredContent: res.structuredContent as Record<string, unknown> | undefined,
  };
}

/** Extract the `confirm` token from a guardrail dry-run preview's error text. */
export function extractConfirmToken(text: string): string {
  const match = /confirm:\s*"([^"]+)"/.exec(text);
  if (!match?.[1]) throw new Error(`no confirm token found in guardrail response: ${text}`);
  return match[1];
}

/** Dry-run then confirm a guardrailed tool call in one step; returns the confirmed result. */
export async function guardedCall(client: Client, name: string, args: Record<string, unknown>): Promise<CallOutcome> {
  const preview = await call(client, name, args);
  if (!preview.isError)
    throw new Error(`expected ${name} to require confirmation (dry-run), got success: ${preview.text}`);
  const token = extractConfirmToken(preview.text);
  return call(client, name, { ...args, dry_run: false, confirm: token });
}
