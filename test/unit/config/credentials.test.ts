import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getKomodoCredentials } from "../../../src/config/env.js";
import { durationSchema, parseDurationString } from "../../../src/config/duration.js";

// Every env var getKomodoCredentials() reads, including the real
// KOMODO_API_KEY/KOMODO_API_SECRET this host has exported for the live MCP
// tool config — cleared before each test and restored (never logged) after,
// so tests exercise controlled fake values only, never the real secret.
const ENV_KEYS = [
  "KOMODO_URL",
  "KOMODO_USERNAME",
  "KOMODO_PASSWORD",
  "KOMODO_API_KEY",
  "KOMODO_API_SECRET",
  "KOMODO_JWT_TOKEN",
  "KOMODO_USERNAME_FILE",
  "KOMODO_PASSWORD_FILE",
  "KOMODO_API_KEY_FILE",
  "KOMODO_API_SECRET_FILE",
  "KOMODO_JWT_TOKEN_FILE",
] as const;

describe("getKomodoCredentials", () => {
  let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  let tmpDir: string;

  beforeEach(() => {
    originalEnv = {};
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    tmpDir = mkdtempSync(join(tmpdir(), "komodo-mcp-test-"));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const original = originalEnv[key];
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prefers the env var over the *_FILE path when both are set", () => {
    const secretPath = join(tmpDir, "api_key");
    writeFileSync(secretPath, "file-key\n");
    process.env["KOMODO_API_KEY"] = "env-key";
    process.env["KOMODO_API_KEY_FILE"] = secretPath;

    const creds = getKomodoCredentials();
    expect(creds.apiKey).toBe("env-key");
  });

  it("falls back to reading the *_FILE path when the env var is absent", () => {
    const secretPath = join(tmpDir, "api_secret");
    writeFileSync(secretPath, "file-secret\n");
    process.env["KOMODO_API_SECRET_FILE"] = secretPath;

    const creds = getKomodoCredentials();
    expect(creds.apiSecret).toBe("file-secret");
  });

  it("trims whitespace/newlines read from the secret file", () => {
    const secretPath = join(tmpDir, "jwt");
    writeFileSync(secretPath, "  file-jwt-token  \n");
    process.env["KOMODO_JWT_TOKEN_FILE"] = secretPath;

    const creds = getKomodoCredentials();
    expect(creds.jwtToken).toBe("file-jwt-token");
  });

  it("returns undefined when neither env var nor file is set", () => {
    const creds = getKomodoCredentials();
    expect(creds.jwtToken).toBeUndefined();
    expect(creds.apiKey).toBeUndefined();
    expect(creds.apiSecret).toBeUndefined();
  });

  it("returns undefined (not throw) when the *_FILE path doesn't exist", () => {
    process.env["KOMODO_PASSWORD_FILE"] = join(tmpDir, "does-not-exist");
    const creds = getKomodoCredentials();
    expect(creds.password).toBeUndefined();
  });

  it("reads KOMODO_URL directly from the env with no file fallback", () => {
    process.env["KOMODO_URL"] = "http://localhost:9120";
    const creds = getKomodoCredentials();
    expect(creds.url).toBe("http://localhost:9120");
  });
});

describe("durationSchema", () => {
  it('parses "30s" to 30000ms', () => {
    expect(durationSchema("1m").parse("30s")).toBe(30_000);
  });

  it('parses "1m" to 60000ms', () => {
    expect(durationSchema("30s").parse("1m")).toBe(60_000);
  });

  it("parses a plain numeric string as milliseconds", () => {
    expect(durationSchema("30s").parse("5000")).toBe(5000);
  });

  it("parses a plain number as milliseconds unchanged", () => {
    expect(durationSchema("30s").parse(1234)).toBe(1234);
  });

  it("defaults to parsing defaultValue when input is undefined", () => {
    expect(durationSchema("2m").parse(undefined)).toBe(120_000);
  });
});

describe("parseDurationString", () => {
  it('parses "2h" to 7200000ms', () => {
    expect(parseDurationString("2h")).toBe(7_200_000);
  });

  it("throws on an unrecognized format", () => {
    expect(() => parseDurationString("banana")).toThrow();
  });
});
