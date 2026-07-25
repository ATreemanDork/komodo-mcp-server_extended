/**
 * Provider (GitProviderAccount + DockerRegistryAccount) — integration test
 * Komodo just stores these credentials, it doesn't validate them live at
 * creation time — so CRUD is fully testable with a dummy token, no real
 * Gitea/registry credentials required.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startIntegrationClient, uniqueName, call, guardedCall, type IntegrationClient } from "./helpers.js";

describe.skipIf(!process.env["KOMODO_URL"])("Provider (integration)", () => {
  let ctx: IntegrationClient;
  const gitDomain = `${uniqueName("git")}.invalid`;
  const registryDomain = `${uniqueName("reg")}.invalid`;
  let gitAccountId = "";
  let registryAccountId = "";

  beforeAll(async () => {
    ctx = await startIntegrationClient();
  });

  afterAll(async () => {
    if (gitAccountId)
      await guardedCall(ctx.client, "komodo_git_provider_delete", { account: gitAccountId }).catch(() => {});
    if (registryAccountId)
      await guardedCall(ctx.client, "komodo_docker_registry_delete", { account: registryAccountId }).catch(() => {});
    await ctx.stop();
  });

  it("creates a git provider account (dummy token — never a real secret)", async () => {
    const res = await call(ctx.client, "komodo_git_provider_apply", {
      action: "create",
      domain: gitDomain,
      https: true,
      username: "itest",
      token: "dummy-token-not-real",
    });
    expect(res.isError).toBeFalsy();
    const resource = res.structuredContent?.["resource"] as Record<string, unknown> | undefined;
    gitAccountId = (resource?.["id"] as string | undefined) ?? "";
    expect(gitAccountId).toBeTruthy();
  });

  it("lists it with the token redacted (has_token, no raw value)", async () => {
    const res = await call(ctx.client, "komodo_git_provider_list");
    expect(res.isError).toBeFalsy();
    expect(res.text).not.toContain("dummy-token-not-real");
  });

  it("deletes the git provider account (guardrailed)", async () => {
    const res = await guardedCall(ctx.client, "komodo_git_provider_delete", { account: gitAccountId });
    expect(res.isError).toBeFalsy();
    gitAccountId = "";
  });

  it("creates a docker registry account (dummy token)", async () => {
    const res = await call(ctx.client, "komodo_docker_registry_apply", {
      action: "create",
      domain: registryDomain,
      username: "itest",
      token: "dummy-token-not-real",
    });
    expect(res.isError).toBeFalsy();
    const resource = res.structuredContent?.["resource"] as Record<string, unknown> | undefined;
    registryAccountId = (resource?.["id"] as string | undefined) ?? "";
    expect(registryAccountId).toBeTruthy();
  });

  it("lists it with the token redacted", async () => {
    const res = await call(ctx.client, "komodo_docker_registry_list");
    expect(res.isError).toBeFalsy();
    expect(res.text).not.toContain("dummy-token-not-real");
  });

  it("deletes the docker registry account (guardrailed)", async () => {
    const res = await guardedCall(ctx.client, "komodo_docker_registry_delete", { account: registryAccountId });
    expect(res.isError).toBeFalsy();
    registryAccountId = "";
  });
});
