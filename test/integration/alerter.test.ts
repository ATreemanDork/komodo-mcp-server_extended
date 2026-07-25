/**
 * Alerter — integration test (real Komodo instance)
 * Full CRUD using a "Custom" endpoint (no real Slack/Discord creds needed).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startIntegrationClient, uniqueName, call, guardedCall, type IntegrationClient } from "./helpers.js";

describe.skipIf(!process.env["KOMODO_URL"])("Alerter (integration)", () => {
  let ctx: IntegrationClient;
  const name = uniqueName("alerter");
  let deleted = false;

  beforeAll(async () => {
    ctx = await startIntegrationClient();
  });

  afterAll(async () => {
    if (!deleted) await guardedCall(ctx.client, "komodo_alerter_delete", { alerter: name }).catch(() => {});
    await ctx.stop();
  });

  it("creates the alerter with a Custom endpoint", async () => {
    const res = await call(ctx.client, "komodo_alerter_apply", {
      action: "create",
      name,
      config: { enabled: false, endpoint: { type: "Custom", params: { url: "https://example.invalid/webhook" } } },
    });
    expect(res.isError).toBeFalsy();
  });

  it("lists it", async () => {
    const res = await call(ctx.client, "komodo_alerter_list");
    expect(res.text).toContain(name);
  });

  it("gets its info", async () => {
    const res = await call(ctx.client, "komodo_alerter_info", { alerter: name });
    expect(res.isError).toBeFalsy();
  });

  it("updates it (enable)", async () => {
    const res = await call(ctx.client, "komodo_alerter_apply", {
      action: "update",
      alerter: name,
      config: { enabled: true },
    });
    expect(res.isError).toBeFalsy();
  });

  it("deletes it (guardrailed)", async () => {
    const res = await guardedCall(ctx.client, "komodo_alerter_delete", { alerter: name });
    expect(res.isError).toBeFalsy();
    deleted = true;
  });

  it("no longer appears in the list", async () => {
    const res = await call(ctx.client, "komodo_alerter_list");
    expect(res.text).not.toContain(name);
  });
});
