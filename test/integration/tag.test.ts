/**
 * Tag — integration test (real Komodo instance)
 *
 * Full CRUD lifecycle against the target server: create → list/info → rename+recolor
 * → delete → verify gone. Exercises the ObjectId-vs-name resolve pattern
 * (`resolveTagObjectId`) live, not just via the tool's own internal call.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startIntegrationClient, uniqueName, call, guardedCall, type IntegrationClient } from "./helpers.js";

describe.skipIf(!process.env["KOMODO_URL"])("Tag (integration)", () => {
  let ctx: IntegrationClient;
  const name = uniqueName("tag");
  let currentName = name;
  let deleted = false;

  beforeAll(async () => {
    ctx = await startIntegrationClient();
  });

  afterAll(async () => {
    if (!deleted) await guardedCall(ctx.client, "komodo_tag_delete", { tag: currentName }).catch(() => {});
    await ctx.stop();
  });

  it("creates the tag", async () => {
    const res = await call(ctx.client, "komodo_tag_apply", { action: "create", name, color: "Blue" });
    expect(res.isError).toBeFalsy();
  });

  it("lists it", async () => {
    const res = await call(ctx.client, "komodo_tag_list");
    expect(res.isError).toBeFalsy();
    expect(res.text).toContain(name);
  });

  it("gets its info", async () => {
    const res = await call(ctx.client, "komodo_tag_info", { tag: name });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent?.["tag"]).toMatchObject({ name, color: "Blue" });
  });

  it("renames and recolors it (RenameTag/UpdateTagColor, resolved by name)", async () => {
    const res = await call(ctx.client, "komodo_tag_apply", {
      action: "update",
      tag: name,
      name: `${name}-renamed`,
      color: "Red",
    });
    expect(res.isError).toBeFalsy();
    currentName = `${name}-renamed`;
  });

  it("deletes it by the new name, resolved to the real ObjectId (guardrailed dry-run/confirm)", async () => {
    const confirmed = await guardedCall(ctx.client, "komodo_tag_delete", { tag: currentName });
    expect(confirmed.isError).toBeFalsy();
    deleted = true;
  });

  it("no longer appears in the list", async () => {
    const res = await call(ctx.client, "komodo_tag_list");
    expect(res.text).not.toContain(currentName);
  });
});
