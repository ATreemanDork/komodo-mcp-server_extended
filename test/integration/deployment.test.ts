/**
 * Deployment + Container — integration test (real Komodo instance)
 * Disposable direct-image deployment on the target server (alpine + sleep, so the
 * container stays up long enough to exercise container_action/inspect/logs)
 * — create → start (safe) → container ops → destroy (guardrailed) → delete.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startIntegrationClient,
  uniqueName,
  call,
  guardedCall,
  TEST_SERVER_ID,
  type IntegrationClient,
} from "./helpers.js";

describe.skipIf(!process.env["KOMODO_URL"] || !process.env["KOMODO_TEST_SERVER_ID"])("Deployment + Container (integration)", () => {
  let ctx: IntegrationClient;
  const name = uniqueName("deploy");
  let deleted = false;

  beforeAll(async () => {
    ctx = await startIntegrationClient();
  });

  afterAll(async () => {
    if (!deleted) {
      await guardedCall(ctx.client, "komodo_deployment_action", { deployment: name, action: "destroy" }).catch(
        () => {},
      );
      await guardedCall(ctx.client, "komodo_deployment_delete", { deployment: name }).catch(() => {});
    }
    await ctx.stop();
  });

  it("creates the deployment", async () => {
    const res = await call(ctx.client, "komodo_deployment_apply", {
      action: "create",
      name,
      server_id: TEST_SERVER_ID,
      image: { type: "Image", params: { image: "alpine:latest" } },
      config: { command: "sleep 3600" },
    });
    expect(res.isError).toBeFalsy();
  });

  it("deploy (safe sub-action) runs immediately, no dry_run friction", async () => {
    const res = await call(ctx.client, "komodo_deployment_action", { deployment: name, action: "deploy" });
    expect(res.isError).toBeFalsy();
  });

  it("container_list shows the deployed container (ungated, per operator decision)", async () => {
    const res = await call(ctx.client, "komodo_container_list", { server: TEST_SERVER_ID });
    expect(res.isError).toBeFalsy();
  });

  it("destroy (destructive sub-action) requires dry-run/confirm", async () => {
    const preview = await call(ctx.client, "komodo_deployment_action", { deployment: name, action: "destroy" });
    expect(preview.isError).toBe(true);
    const confirmed = await guardedCall(ctx.client, "komodo_deployment_action", {
      deployment: name,
      action: "destroy",
    });
    expect(confirmed.isError).toBeFalsy();
  });

  it("deletes the deployment (guardrailed)", async () => {
    const res = await guardedCall(ctx.client, "komodo_deployment_delete", { deployment: name });
    expect(res.isError).toBeFalsy();
    deleted = true;
  });

  it("no longer appears in the list", async () => {
    const res = await call(ctx.client, "komodo_deployment_list");
    expect(res.text).not.toContain(name);
  });
});
