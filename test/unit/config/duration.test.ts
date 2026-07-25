/**
 * Duration parsing — unit tests.
 */

import { describe, it, expect } from "vitest";
import { parseDurationString, durationSchema } from "../../../src/config/duration.js";

describe("parseDurationString", () => {
  it("parses plain milliseconds", () => {
    expect(parseDurationString("500")).toBe(500);
  });

  it.each([
    ["30s", 30_000],
    ["1m", 60_000],
    ["2m", 120_000],
    ["1h", 3_600_000],
  ])("parses %s as %d ms", (input, expected) => {
    expect(parseDurationString(input)).toBe(expected);
  });

  it("throws on an unparseable string", () => {
    expect(() => parseDurationString("not-a-duration")).toThrow();
  });
});

describe("durationSchema", () => {
  it("falls back to the default when the env var is unset", () => {
    const schema = durationSchema("30s");
    expect(schema.parse(undefined)).toBe(30_000);
  });

  it("parses a provided override", () => {
    const schema = durationSchema("30s");
    expect(schema.parse("2m")).toBe(120_000);
  });

  it("accepts plain numeric ms directly", () => {
    const schema = durationSchema("30s");
    expect(schema.parse("5000")).toBe(5000);
  });
});
