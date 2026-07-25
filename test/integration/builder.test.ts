/**
 * Builder — integration test (real Komodo instance)
 * Full CRUD using a "Server" builder pointed at the target server — directly the
 * shape that closes the "Must attach builder to RunBuild" gap.
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

describe.skipIf(!process.env["KOMODO_URL"] || !process.env["KOMODO_TEST_SERVER_ID"])("Builder (integration)", () => {
  let ctx: IntegrationClient;
  const name = uniqueName("builder");
  let currentName = name;
  let deleted = false;

  beforeAll(async () => {
    ctx = await startIntegrationClient();
  });

  afterAll(async () => {
    if (!deleted) await guardedCall(ctx.client, "komodo_builder_delete", { builder: currentName }).catch(() => {});
    await ctx.stop();
  });

  it("creates a Server-type builder pointed at the target server", async () => {
    const res = await call(ctx.client, "komodo_builder_apply", {
      action: "create",
      name,
      config: { type: "Server", params: { server_id: TEST_SERVER_ID } },
    });
    expect(res.isError).toBeFalsy();
  });

  it("lists and gets info", async () => {
    expect((await call(ctx.client, "komodo_builder_list")).text).toContain(name);
    const info = await call(ctx.client, "komodo_builder_info", { builder: name });
    expect(info.isError).toBeFalsy();
  });

  it("copies it", async () => {
    const copyName = `${name}-copy`;
    const res = await call(ctx.client, "komodo_builder_copy", { name: copyName, id: name });
    expect(res.isError).toBeFalsy();
    const del = await guardedCall(ctx.client, "komodo_builder_delete", { builder: copyName });
    expect(del.isError).toBeFalsy();
  });

  it("renames it (RenameBuilder — write() but returns Update, polled)", async () => {
    const res = await call(ctx.client, "komodo_builder_rename", { builder: name, name: `${name}-renamed` });
    expect(res.isError).toBeFalsy();
    currentName = `${name}-renamed`;
  });

  it("deletes it (guardrailed)", async () => {
    const res = await guardedCall(ctx.client, "komodo_builder_delete", { builder: currentName });
    expect(res.isError).toBeFalsy();
    deleted = true;
  });

  it("no longer appears in the list", async () => {
    const res = await call(ctx.client, "komodo_builder_list");
    expect(res.text).not.toContain(currentName);
  });
});
