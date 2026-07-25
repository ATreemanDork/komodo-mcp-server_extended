import { describe, it, expect } from "vitest";
import { resolveAuth, ApiKeyAuth, JwtAuth, PasswordAuth } from "../../../src/client.js";

describe("resolveAuth", () => {
  it("prefers API key auth when apiKey+apiSecret, jwtToken, and username+password are all present", () => {
    const auth = resolveAuth({
      apiKey: "key",
      apiSecret: "secret",
      jwtToken: "jwt",
      username: "user",
      password: "pass",
    });
    expect(auth).toBeInstanceOf(ApiKeyAuth);
    expect(auth?.method).toBe("api-key");
  });

  it("falls back to JWT auth when no API key/secret pair is present", () => {
    const auth = resolveAuth({
      jwtToken: "jwt",
      username: "user",
      password: "pass",
    });
    expect(auth).toBeInstanceOf(JwtAuth);
    expect(auth?.method).toBe("jwt");
  });

  it("falls back to password auth when neither API key/secret nor JWT are present", () => {
    const auth = resolveAuth({
      username: "user",
      password: "pass",
    });
    expect(auth).toBeInstanceOf(PasswordAuth);
    expect(auth?.method).toBe("password");
  });

  it("returns null when apiKey is present without apiSecret and nothing else is sufficient", () => {
    const auth = resolveAuth({
      apiKey: "key",
    });
    expect(auth).toBeNull();
  });

  it("returns null when credentials object is empty", () => {
    expect(resolveAuth({})).toBeNull();
  });

  it("does not treat apiSecret alone (without apiKey) as sufficient", () => {
    const auth = resolveAuth({ apiSecret: "secret" });
    expect(auth).toBeNull();
  });

  it("does not treat username alone (without password) as sufficient", () => {
    const auth = resolveAuth({ username: "user" });
    expect(auth).toBeNull();
  });
});
