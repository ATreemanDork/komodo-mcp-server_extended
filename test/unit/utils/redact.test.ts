/**
 * Output redaction — unit tests.
 * This module is the single scrubbing layer for the tool-output channel
 * (issue #160). A gap here re-opens the secret-leak surface across every
 * domain, so the boundaries are pinned down explicitly — including what it
 * deliberately does NOT catch (conditionally-secret fields like a Variable's
 * `value`, which the domain must pre-map itself).
 */

import { describe, it, expect } from "vitest";
import { redactObject, maskEnvPairs, scrubText, redactTomlSecrets, REDACTED } from "../../../src/utils/redact.js";

describe("redactObject", () => {
  it("redacts key-name-signalled secrets by field name", () => {
    const out = redactObject({
      name: "x",
      token: "ghp_secret",
      webhook_secret: "whsec_1",
      passkey: "pk_1",
      secret_args: "DB_PASS=hunter2",
      private_key: "-----BEGIN-----",
    });
    expect(out.name).toBe("x");
    expect(out.token).toBe(REDACTED);
    expect(out.webhook_secret).toBe(REDACTED);
    expect(out.passkey).toBe(REDACTED);
    expect(out.secret_args).toBe(REDACTED);
    expect(out.private_key).toBe(REDACTED);
  });

  it("walks nested objects and arrays", () => {
    const out = redactObject({
      config: { params: { accounts: [{ username: "u", token: "t" }] } },
    });
    expect(out.config.params.accounts[0]!.username).toBe("u");
    expect(out.config.params.accounts[0]!.token).toBe(REDACTED);
  });

  it("masks env-blob fields per-pair, keeping non-secret keys visible", () => {
    const out = redactObject({
      config: { environment: "PORT=8080\nAPI_KEY=sk-live-123\nDB_PASSWORD=hunter2" },
    });
    expect(out.config.environment).toContain("PORT=8080");
    expect(out.config.environment).toContain(`API_KEY=${REDACTED}`);
    expect(out.config.environment).toContain(`DB_PASSWORD=${REDACTED}`);
    expect(out.config.environment).not.toContain("sk-live-123");
    expect(out.config.environment).not.toContain("hunter2");
  });

  it("masks Docker Config.Env (string array) per-pair", () => {
    const out = redactObject({ Config: { Env: ["PATH=/usr/bin", "SECRET_TOKEN=abc"] } });
    expect(out.Config.Env).toEqual(["PATH=/usr/bin", `SECRET_TOKEN=${REDACTED}`]);
  });

  it("scrubs credential patterns inside a `command` field value", () => {
    const out = redactObject({ pre_deploy: { path: ".", command: "docker login -p hunter2 reg.io" } });
    expect(out.pre_deploy.command).toContain(`-p ${REDACTED}`);
    expect(out.pre_deploy.command).not.toContain("hunter2");
  });

  it("does NOT redact conditionally-secret fields by value (Variable `value` is domain-handled)", () => {
    // `value` is not a secret-signalling key name; secrecy depends on the
    // sibling `is_secret` flag, which the key name alone can't see. This is
    // deliberately variable.ts's job, not the generic redactor's.
    const out = redactObject({ name: "V", value: "plaintext", is_secret: true });
    expect(out.value).toBe("plaintext");
  });

  it("does NOT redact public identifiers (public_key is public, not secret)", () => {
    const out = redactObject({ public_key: "pub-abc", ssh_public_key: "ssh-rsa AAA", token: "t" });
    expect(out.public_key).toBe("pub-abc");
    expect(out.ssh_public_key).toBe("ssh-rsa AAA");
    expect(out.token).toBe(REDACTED);
  });

  it("leaves primitives and non-objects untouched", () => {
    expect(redactObject("hi")).toBe("hi");
    expect(redactObject(42)).toBe(42);
    expect(redactObject(null)).toBe(null);
  });
});

describe("maskEnvPairs", () => {
  it("masks value side of sensitive pairs in a newline string", () => {
    expect(maskEnvPairs("A=1\nPASSWORD=x")).toBe(`A=1\nPASSWORD=${REDACTED}`);
  });
  it("masks value side of sensitive pairs in a string array", () => {
    expect(maskEnvPairs(["A=1", "TOKEN=x"])).toEqual(["A=1", `TOKEN=${REDACTED}`]);
  });
  it("leaves a line with no '=' alone", () => {
    expect(maskEnvPairs("just a comment")).toBe("just a comment");
  });
});

describe("scrubText", () => {
  it("scrubs docker login password flags", () => {
    expect(scrubText("docker login -u foo -p hunter2 registry.io")).toContain(`-p ${REDACTED}`);
    expect(scrubText("docker login -u foo -p hunter2 registry.io")).not.toContain("hunter2");
  });
  it("scrubs credentials embedded in URLs", () => {
    expect(scrubText("git clone https://user:ghp_tok@github.com/x")).not.toContain("ghp_tok");
    expect(scrubText("git clone https://ghp_tok@github.com/x")).not.toContain("ghp_tok");
  });
  it("scrubs Authorization headers", () => {
    expect(scrubText("Authorization: Bearer abc.def.ghi")).not.toContain("abc.def.ghi");
  });
  it("scrubs sensitive KEY=VALUE assignments (mount options, env in commands)", () => {
    expect(scrubText("addr=host,username=u,password=hunter2")).toContain(`password=${REDACTED}`);
    expect(scrubText("addr=host,username=u,password=hunter2")).not.toContain("hunter2");
  });
  it("leaves clean text unchanged", () => {
    expect(scrubText("deployed ok in 3s")).toBe("deployed ok in 3s");
  });
});

describe("redactTomlSecrets", () => {
  const toml = [
    "[[variable]]",
    'name = "PUBLIC"',
    'value = "visible"',
    "is_secret = false",
    "",
    "[[variable]]",
    'name = "DB_PASS"',
    'value = "hunter2"',
    "is_secret = true",
    "",
    "[[stack]]",
    'name = "web"',
  ].join("\n");

  it("masks value of is_secret variables, leaves non-secret ones", () => {
    const out = redactTomlSecrets(toml);
    expect(out).toContain('value = "visible"');
    expect(out).not.toContain("hunter2");
    expect(out).toContain(`value = "${REDACTED}"`);
  });
  it("does not touch non-variable tables", () => {
    expect(redactTomlSecrets(toml)).toContain('name = "web"');
  });
});
