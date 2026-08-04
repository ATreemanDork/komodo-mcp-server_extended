/**
 * defineTool()'s guardrail wrapper — unit tests
 *
 * Exercises the dry-run/confirm dance directly against a synthetic tool
 * (no domain code, no transport) — the core safety property: a
 * guardrailed tool's real handler must never run without a prior,
 * token-bound, non-expired, exact-args-matching confirm call.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { defineTool } from "../../../src/mcp/define-tool.js";
import { destructiveWhenActionIn } from "../../../src/guardrails/policy.js";
import { GUARDRAIL_TTL_MS } from "../../../src/guardrails/confirm.js";

const extra = {} as Parameters<ReturnType<typeof defineTool>["handler"]>[1];

function extractConfirmToken(text: string): string {
  const match = /confirm:\s*"([^"]+)"/.exec(text);
  if (!match?.[1]) throw new Error(`no confirm token found in: ${text}`);
  return match[1];
}

afterEach(() => {
  vi.useRealTimers();
});

describe("defineTool — ungated tools", () => {
  it("calls the handler directly and does not add dry_run/confirm fields", async () => {
    const handler = vi.fn(async (args: { name: string }) => ({
      content: [{ type: "text" as const, text: `hi ${args.name}` }],
    }));
    const tool = defineTool({
      name: "test_ungated",
      description: "test",
      input: z.object({ name: z.string() }),
      handler,
    });

    expect(tool.inputSchema.shape).not.toHaveProperty("dry_run");
    expect(tool.inputSchema.shape).not.toHaveProperty("confirm");

    const result = await tool.handler({ name: "alice" }, extra);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ name: "alice" }, extra);
    expect(result.isError).toBeFalsy();
  });
});

describe("defineTool — static guardrail tier", () => {
  function makeGuardedTool() {
    const handler = vi.fn(async (args: { id: string }) => ({
      content: [{ type: "text" as const, text: `deleted ${args.id}` }],
    }));
    const tool = defineTool({
      name: "test_delete",
      description: "test",
      input: z.object({ id: z.string() }),
      guardrail: "destructive",
      handler,
    });
    return { tool, handler };
  }

  it("adds dry_run/confirm to the input schema", () => {
    const { tool } = makeGuardedTool();
    expect(tool.inputSchema.shape).toHaveProperty("dry_run");
    expect(tool.inputSchema.shape).toHaveProperty("confirm");
  });

  it("omitted dry_run previews without calling the handler and returns a confirm token", async () => {
    const { tool, handler } = makeGuardedTool();
    const result = await tool.handler({ id: "res-1" }, extra);
    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain("Confirmation required");
    expect(() => extractConfirmToken(text)).not.toThrow();
  });

  it("dry_run: true behaves the same as omitted", async () => {
    const { tool, handler } = makeGuardedTool();
    const result = await tool.handler({ id: "res-1", dry_run: true }, extra);
    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  it("dry_run: false + valid confirm token + identical args executes the real handler", async () => {
    const { tool, handler } = makeGuardedTool();
    const preview = await tool.handler({ id: "res-1" }, extra);
    const token = extractConfirmToken((preview.content?.[0] as { text: string }).text);

    const result = await tool.handler({ id: "res-1", dry_run: false, confirm: token }, extra);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ id: "res-1" }, extra);
    expect(result.isError).toBeFalsy();
    expect((result.content?.[0] as { text: string }).text).toBe("deleted res-1");
  });

  it("a confirm token is single-use — replaying it (even with identical args) is rejected", async () => {
    const { tool, handler } = makeGuardedTool();
    const preview = await tool.handler({ id: "res-1" }, extra);
    const token = extractConfirmToken((preview.content?.[0] as { text: string }).text);

    const first = await tool.handler({ id: "res-1", dry_run: false, confirm: token }, extra);
    expect(first.isError).toBeFalsy();

    const replay = await tool.handler({ id: "res-1", dry_run: false, confirm: token }, extra);
    expect(handler).toHaveBeenCalledTimes(1); // handler NOT re-invoked on replay
    expect(replay.isError).toBe(true);
    expect((replay.content?.[0] as { text: string }).text).toContain("already used");
  });

  it("dry_run: false with no confirm token is rejected without calling the handler", async () => {
    const { tool, handler } = makeGuardedTool();
    const result = await tool.handler({ id: "res-1", dry_run: false }, extra);
    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text: string }).text).toContain("no confirm token was provided");
  });

  it("dry_run: false with a bogus confirm token is rejected", async () => {
    const { tool, handler } = makeGuardedTool();
    const result = await tool.handler({ id: "res-1", dry_run: false, confirm: "not-a-real-token" }, extra);
    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text: string }).text).toContain("rejected");
  });

  it("dry_run: false with a valid token but CHANGED args is rejected (param tampering)", async () => {
    const { tool, handler } = makeGuardedTool();
    const preview = await tool.handler({ id: "res-1" }, extra);
    const token = extractConfirmToken((preview.content?.[0] as { text: string }).text);

    const result = await tool.handler({ id: "res-2", dry_run: false, confirm: token }, extra);
    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text: string }).text).toContain("arguments changed");
  });

  it("a confirm token issued for a different tool is rejected", async () => {
    const { tool: toolA } = makeGuardedTool();
    const toolB = defineTool({
      name: "test_delete_other",
      description: "test",
      input: z.object({ id: z.string() }),
      guardrail: "destructive",
      handler: vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] })),
    });
    const preview = await toolA.handler({ id: "res-1" }, extra);
    const token = extractConfirmToken((preview.content?.[0] as { text: string }).text);

    const result = await toolB.handler({ id: "res-1", dry_run: false, confirm: token }, extra);
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text: string }).text).toContain("different tool");
  });

  it("an expired confirm token is rejected", async () => {
    vi.useFakeTimers();
    const { tool, handler } = makeGuardedTool();
    const preview = await tool.handler({ id: "res-1" }, extra);
    const token = extractConfirmToken((preview.content?.[0] as { text: string }).text);

    vi.advanceTimersByTime(GUARDRAIL_TTL_MS.destructive + 1);

    const result = await tool.handler({ id: "res-1", dry_run: false, confirm: token }, extra);
    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text: string }).text).toContain("expired");
  });

  it("key order in a nested arg object doesn't break the args hash match", async () => {
    const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] }));
    const tool = defineTool({
      name: "test_nested",
      description: "test",
      input: z.object({ target: z.object({ type: z.string(), id: z.string() }) }),
      guardrail: "destructive",
      handler,
    });
    const preview = await tool.handler({ target: { type: "Server", id: "s1" } }, extra);
    const token = extractConfirmToken((preview.content?.[0] as { text: string }).text);

    // Same values, different key insertion order.
    const result = await tool.handler({ target: { id: "s1", type: "Server" }, dry_run: false, confirm: token }, extra);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeFalsy();
  });
});

describe("defineTool — dynamic guardrail classifier (per-action tiering)", () => {
  function makeActionTool() {
    const handler = vi.fn(async (args: { action: string }) => ({
      content: [{ type: "text" as const, text: `ran ${args.action}` }],
    }));
    const tool = defineTool({
      name: "test_action",
      description: "test",
      input: z.object({ action: z.enum(["start", "destroy"]) }),
      guardrail: destructiveWhenActionIn(["destroy"]),
      handler,
    });
    return { tool, handler };
  }

  it("a safe action runs frictionlessly when dry_run is omitted", async () => {
    const { tool, handler } = makeActionTool();
    const result = await tool.handler({ action: "start" }, extra);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeFalsy();
    expect((result.content?.[0] as { text: string }).text).toBe("ran start");
  });

  it("a safe action runs when dry_run is explicitly false", async () => {
    const { tool, handler } = makeActionTool();
    const result = await tool.handler({ action: "start", dry_run: false }, extra);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeFalsy();
  });

  it("a safe action with dry_run: true previews WITHOUT executing (no silent run)", async () => {
    const { tool, handler } = makeActionTool();
    const result = await tool.handler({ action: "start", dry_run: true }, extra);
    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text: string }).text).toMatch(/did NOT run/i);
  });

  it("a destructive action requires the dry-run/confirm dance", async () => {
    const { tool, handler } = makeActionTool();
    const preview = await tool.handler({ action: "destroy" }, extra);
    expect(handler).not.toHaveBeenCalled();
    expect(preview.isError).toBe(true);

    const token = extractConfirmToken((preview.content?.[0] as { text: string }).text);
    const result = await tool.handler({ action: "destroy", dry_run: false, confirm: token }, extra);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeFalsy();
  });

  it("critical tier uses the shorter TTL", async () => {
    vi.useFakeTimers();
    const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] }));
    const tool = defineTool({
      name: "test_critical",
      description: "test",
      input: z.object({ user_id: z.string() }),
      guardrail: "critical",
      handler,
    });
    const preview = await tool.handler({ user_id: "u1" }, extra);
    const token = extractConfirmToken((preview.content?.[0] as { text: string }).text);

    vi.advanceTimersByTime(GUARDRAIL_TTL_MS.critical + 1);
    const result = await tool.handler({ user_id: "u1", dry_run: false, confirm: token }, extra);
    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });
});
