/**
 * OnboardingKey — integration test (real Komodo instance)
 * Create/list/update(privileged flag)/delete — never redeemed (no spare
 * hardware to actually onboard as a new Server).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startIntegrationClient, uniqueName, call, guardedCall, type IntegrationClient } from "./helpers.js";

describe.skipIf(!process.env["KOMODO_URL"])("OnboardingKey (integration)", () => {
  let ctx: IntegrationClient;
  const name = uniqueName("obk");
  let publicKey: string | undefined;
  let deleted = false;

  beforeAll(async () => {
    ctx = await startIntegrationClient();
  });

  afterAll(async () => {
    if (!deleted && publicKey)
      await guardedCall(ctx.client, "komodo_onboarding_key_delete", { public_key: publicKey }).catch(() => {});
    await ctx.stop();
  });

  it("creates the key (critical tier — mints a one-time private_key, requires the dance)", async () => {
    const res = await guardedCall(ctx.client, "komodo_onboarding_key_apply", { action: "create", name });
    expect(res.isError).toBeFalsy();
    // CreateOnboardingKeyResponse nests the resource under `created`, not flat.
    const resource = res.structuredContent?.["resource"] as Record<string, unknown> | undefined;
    const created = resource?.["created"] as Record<string, unknown> | undefined;
    publicKey = created?.["public_key"] as string | undefined;
    expect(publicKey).toBeTruthy();
    // The one-time private_key is the deliverable: gated, NOT redacted (value-reveal guardrail).
    expect(resource?.["private_key"]).toBeTruthy();
  });

  it("lists it", async () => {
    const res = await call(ctx.client, "komodo_onboarding_key_list");
    expect(res.text).toContain(name);
  });

  it("sets privileged:true — critical tier requires the dry-run/confirm dance", async () => {
    const preview = await call(ctx.client, "komodo_onboarding_key_apply", {
      action: "update",
      public_key: publicKey,
      privileged: true,
    });
    expect(preview.isError).toBe(true);
    expect(preview.text).toContain("critical tier");
    const confirmed = await guardedCall(ctx.client, "komodo_onboarding_key_apply", {
      action: "update",
      public_key: publicKey,
      privileged: true,
    });
    expect(confirmed.isError).toBeFalsy();
  });

  it("un-privileging (privileged:false) does NOT require confirmation", async () => {
    const res = await call(ctx.client, "komodo_onboarding_key_apply", {
      action: "update",
      public_key: publicKey,
      privileged: false,
    });
    expect(res.isError).toBeFalsy();
  });

  it("deletes it (guardrailed)", async () => {
    const res = await guardedCall(ctx.client, "komodo_onboarding_key_delete", { public_key: publicKey });
    expect(res.isError).toBeFalsy();
    deleted = true;
  });

  it("no longer appears in the list", async () => {
    const res = await call(ctx.client, "komodo_onboarding_key_list");
    expect(res.text).not.toContain(name);
  });
});
