/**
 * Ephemeral Resource Registry — unit tests
 *
 * Pure registry logic (no SDK transport): registration, session isolation,
 * and expiry (both lazy-on-read and the periodic sweep).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  registerEphemeralResource,
  readEphemeralResource,
  clearEphemeralResources,
  startResourceSweep,
  stopResourceSweep,
  EPHEMERAL_URI_SCHEME,
} from "../../../src/mcp/resources.js";

afterEach(() => {
  clearEphemeralResources();
  vi.useRealTimers();
});

describe("registerEphemeralResource / readEphemeralResource", () => {
  it("round-trips content for the registering session", () => {
    const { uri } = registerEphemeralResource({
      sessionId: "session-a",
      category: "logs",
      mimeType: "text/plain",
      content: "hello world",
      ttlMs: 60_000,
    });

    expect(uri.startsWith(`${EPHEMERAL_URI_SCHEME}://logs/`)).toBe(true);

    const resource = readEphemeralResource(uri, "session-a");
    expect(resource).toEqual({ uri, mimeType: "text/plain", content: "hello world" });
  });

  it("returns undefined for a different session (session isolation)", () => {
    const { uri } = registerEphemeralResource({
      sessionId: "session-a",
      category: "logs",
      mimeType: "text/plain",
      content: "hello world",
      ttlMs: 60_000,
    });

    expect(readEphemeralResource(uri, "session-b")).toBeUndefined();
    expect(readEphemeralResource(uri, undefined)).toBeUndefined();
  });

  it("returns undefined for an unknown uri", () => {
    expect(readEphemeralResource("ephemeral://logs/does-not-exist", "session-a")).toBeUndefined();
  });

  it("expires lazily on read once the TTL has elapsed", () => {
    vi.useFakeTimers();
    const { uri } = registerEphemeralResource({
      sessionId: "session-a",
      category: "inspect",
      mimeType: "application/json",
      content: "{}",
      ttlMs: 1_000,
    });

    expect(readEphemeralResource(uri, "session-a")).toBeDefined();

    vi.advanceTimersByTime(1_001);

    expect(readEphemeralResource(uri, "session-a")).toBeUndefined();
  });

  it("generates a distinct uri per registration, even for the same category", () => {
    const first = registerEphemeralResource({
      sessionId: "session-a",
      category: "compose",
      mimeType: "text/yaml",
      content: "a",
      ttlMs: 60_000,
    });
    const second = registerEphemeralResource({
      sessionId: "session-a",
      category: "compose",
      mimeType: "text/yaml",
      content: "b",
      ttlMs: 60_000,
    });

    expect(first.uri).not.toBe(second.uri);
  });
});

describe("startResourceSweep / stopResourceSweep", () => {
  it("removes expired entries once the sweep interval elapses", () => {
    vi.useFakeTimers();

    const { uri } = registerEphemeralResource({
      sessionId: "session-a",
      category: "info",
      mimeType: "application/json",
      content: "{}",
      ttlMs: 500,
    });

    startResourceSweep(1_000);

    // Entry still valid, sweep hasn't run yet.
    vi.advanceTimersByTime(400);
    expect(readEphemeralResource(uri, "session-a")).toBeDefined();

    // TTL elapsed and the first sweep tick has fired.
    vi.advanceTimersByTime(1_000);
    expect(readEphemeralResource(uri, "session-a")).toBeUndefined();

    stopResourceSweep();
  });

  it("is idempotent — a second start before stop does not throw or double-schedule", () => {
    vi.useFakeTimers();
    startResourceSweep(1_000);
    expect(() => {
      startResourceSweep(1_000);
    }).not.toThrow();
    stopResourceSweep();
  });
});
