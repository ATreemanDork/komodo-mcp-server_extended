/**
 * Variable — integration test (real Komodo instance)
 * Full CRUD: create → list/info → update → delete → verify gone.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startIntegrationClient, uniqueName, call, guardedCall, type IntegrationClient } from "./helpers.js";

describe.skipIf(!process.env["KOMODO_URL"])("Variable (integration)", () => {
  let ctx: IntegrationClient;
  // Komodo's variableNameSchema requires ^[a-zA-Z_][a-zA-Z0-9_]*$ — no hyphens,
  // unlike every other domain's resourceNameSchema (confirmed via live testing).
  const name = uniqueName("var").replace(/-/g, "_");
  let deleted = false;

  beforeAll(async () => {
    ctx = await startIntegrationClient();
  });

  afterAll(async () => {
    if (!deleted) await guardedCall(ctx.client, "komodo_variable_delete", { name }).catch(() => {});
    await ctx.stop();
  });

  it("creates the variable", async () => {
    const res = await call(ctx.client, "komodo_variable_apply", {
      action: "create",
      name,
      value: "v1",
      description: "integration test",
    });
    expect(res.isError).toBeFalsy();
  });

  it("list succeeds (the target server may already hold many real variables — not asserting our item is on the default first page)", async () => {
    const res = await call(ctx.client, "komodo_variable_list");
    expect(res.isError).toBeFalsy();
  });

  it("gets its info", async () => {
    const res = await call(ctx.client, "komodo_variable_info", { name });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent?.["variable"]).toMatchObject({ name, value: "v1" });
  });

  it("updates its value", async () => {
    const res = await call(ctx.client, "komodo_variable_apply", { action: "update", name, value: "v2" });
    expect(res.isError).toBeFalsy();
    const info = await call(ctx.client, "komodo_variable_info", { name });
    expect(info.structuredContent?.["variable"]).toMatchObject({ value: "v2" });
  });

  it("deletes it (guardrailed)", async () => {
    const res = await guardedCall(ctx.client, "komodo_variable_delete", { name });
    expect(res.isError).toBeFalsy();
    deleted = true;
  });

  it("no longer appears in the list", async () => {
    const res = await call(ctx.client, "komodo_variable_list");
    expect(res.text).not.toContain(name);
  });
});
