/**
 * Stack — integration test (real Komodo instance)
 * Disposable compose stack on the target server: create → deploy (safe action, no
 * guardrail friction) → destroy (destructive, dry-run/confirm) → delete.
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

describe.skipIf(!process.env["KOMODO_URL"] || !process.env["KOMODO_TEST_SERVER_ID"])("Stack (integration)", () => {
  let ctx: IntegrationClient;
  const name = uniqueName("stack");
  let deleted = false;

  beforeAll(async () => {
    ctx = await startIntegrationClient();
  });

  afterAll(async () => {
    if (!deleted) {
      await guardedCall(ctx.client, "komodo_stack_action", { stack: name, action: "destroy" }).catch(() => {});
      await guardedCall(ctx.client, "komodo_stack_delete", { stack: name }).catch(() => {});
    }
    await ctx.stop();
  });

  it("creates the stack", async () => {
    const res = await call(ctx.client, "komodo_stack_apply", {
      action: "create",
      name,
      server_id: TEST_SERVER_ID,
      config: { file_contents: "services:\n  app:\n    image: hello-world:linux\n" },
    });
    expect(res.isError).toBeFalsy();
  });

  it("deploy (safe sub-action) runs immediately, no dry_run friction", async () => {
    const res = await call(ctx.client, "komodo_stack_action", { stack: name, action: "deploy" });
    expect(res.isError).toBeFalsy(); // guardrail didn't block it — the real deploy result may itself report success or a container-exit status, both non-guardrail outcomes
  });

  it("destroy (destructive sub-action) requires dry-run/confirm", async () => {
    const preview = await call(ctx.client, "komodo_stack_action", { stack: name, action: "destroy" });
    expect(preview.isError).toBe(true);
    expect(preview.text).toContain("destructive tier");
    const confirmed = await call(ctx.client, "komodo_stack_action", {
      stack: name,
      action: "destroy",
      dry_run: false,
      confirm: /confirm:\s*"([^"]+)"/.exec(preview.text)?.[1],
    });
    expect(confirmed.isError).toBeFalsy();
  });

  it("deletes the stack (guardrailed)", async () => {
    const res = await guardedCall(ctx.client, "komodo_stack_delete", { stack: name });
    expect(res.isError).toBeFalsy();
    deleted = true;
  });

  it("no longer appears in the list", async () => {
    const res = await call(ctx.client, "komodo_stack_list");
    expect(res.text).not.toContain(name);
  });
});
