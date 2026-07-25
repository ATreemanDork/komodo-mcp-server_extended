/**
 * UserGroup — integration test (real Komodo instance)
 * Full CRUD + membership + everyone flag against a disposable group.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startIntegrationClient, uniqueName, call, guardedCall, type IntegrationClient } from "./helpers.js";

describe.skipIf(!process.env["KOMODO_URL"])("UserGroup (integration)", () => {
  let ctx: IntegrationClient;
  const name = uniqueName("ug");
  let currentName = name;
  let deleted = false;

  beforeAll(async () => {
    ctx = await startIntegrationClient();
  });

  afterAll(async () => {
    if (!deleted)
      await guardedCall(ctx.client, "komodo_user_group_delete", { user_group: currentName }).catch(() => {});
    await ctx.stop();
  });

  it("creates the group", async () => {
    const res = await call(ctx.client, "komodo_user_group_apply", { action: "create", name });
    expect(res.isError).toBeFalsy();
  });

  it("lists and gets info", async () => {
    expect((await call(ctx.client, "komodo_user_group_list")).text).toContain(name);
    const info = await call(ctx.client, "komodo_user_group_info", { user_group: name });
    expect(info.structuredContent?.["user_group"]).toMatchObject({ name, everyone: false });
  });

  it("sets everyone:true then back to false", async () => {
    const on = await call(ctx.client, "komodo_user_group_set_everyone", { user_group: name, everyone: true });
    expect(on.isError).toBeFalsy();
    const off = await call(ctx.client, "komodo_user_group_set_everyone", { user_group: name, everyone: false });
    expect(off.isError).toBeFalsy();
  });

  it("renames it (RenameUserGroup, resolved by name — literal ObjectId gotcha)", async () => {
    const res = await call(ctx.client, "komodo_user_group_apply", {
      action: "update",
      user_group: name,
      name: `${name}-renamed`,
    });
    expect(res.isError).toBeFalsy();
    currentName = `${name}-renamed`;
  });

  it("deletes it (guardrailed)", async () => {
    const res = await guardedCall(ctx.client, "komodo_user_group_delete", { user_group: currentName });
    expect(res.isError).toBeFalsy();
    deleted = true;
  });

  it("no longer appears in the list", async () => {
    const res = await call(ctx.client, "komodo_user_group_list");
    expect(res.text).not.toContain(currentName);
  });
});
