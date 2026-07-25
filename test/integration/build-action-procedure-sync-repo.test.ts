/**
 * Build, Action, Procedure, ResourceSync, Repo — integration test
 * CRUD only (create → list → delete) for each — none are actually *run*
 * (a real build costs real time; a real repo clone needs Gitea creds this
 * environment doesn't have configured yet). All five configs are entirely
 * optional-field PATCH-style schemas, so an empty/minimal config is valid
 * for exercising create/delete round-trips.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startIntegrationClient, uniqueName, call, guardedCall, type IntegrationClient } from "./helpers.js";

describe.skipIf(!process.env["KOMODO_URL"])("Build/Action/Procedure/ResourceSync/Repo (integration)", () => {
  let ctx: IntegrationClient;

  beforeAll(async () => {
    ctx = await startIntegrationClient();
  });

  afterAll(async () => {
    await ctx.stop();
  });

  it("Build: create → list → delete", async () => {
    const name = uniqueName("build");
    const created = await call(ctx.client, "komodo_build_apply", { action: "create", name });
    expect(created.isError).toBeFalsy();
    expect((await call(ctx.client, "komodo_build_list")).text).toContain(name);
    const deleted = await guardedCall(ctx.client, "komodo_build_delete", { build: name });
    expect(deleted.isError).toBeFalsy();
  });

  it("Action: create → list → delete", async () => {
    const name = uniqueName("action");
    const created = await call(ctx.client, "komodo_action_apply", { action: "create", name });
    expect(created.isError).toBeFalsy();
    expect((await call(ctx.client, "komodo_action_list")).text).toContain(name);
    const deleted = await guardedCall(ctx.client, "komodo_action_delete", { action_id: name });
    expect(deleted.isError).toBeFalsy();
  });

  it("Procedure: create → list → delete", async () => {
    const name = uniqueName("proc");
    const created = await call(ctx.client, "komodo_procedure_apply", { action: "create", name });
    expect(created.isError).toBeFalsy();
    expect((await call(ctx.client, "komodo_procedure_list")).text).toContain(name);
    const deleted = await guardedCall(ctx.client, "komodo_procedure_delete", { procedure: name });
    expect(deleted.isError).toBeFalsy();
  });

  it("ResourceSync: create → list → delete", async () => {
    const name = uniqueName("sync");
    const created = await call(ctx.client, "komodo_resource_sync_apply", { action: "create", name });
    expect(created.isError).toBeFalsy();
    expect((await call(ctx.client, "komodo_resource_sync_list")).text).toContain(name);
    const deleted = await guardedCall(ctx.client, "komodo_resource_sync_delete", { resource_sync: name });
    expect(deleted.isError).toBeFalsy();
  });

  it("Repo: create → info → delete (no clone — needs real git creds this env doesn't have; the target server may already hold many real repos, so not asserting presence on the default first list page)", async () => {
    const name = uniqueName("repo");
    const created = await call(ctx.client, "komodo_repo_apply", { action: "create", name });
    expect(created.isError).toBeFalsy();
    expect((await call(ctx.client, "komodo_repo_info", { repo: name })).isError).toBeFalsy();
    const deleted = await guardedCall(ctx.client, "komodo_repo_delete", { repo: name });
    expect(deleted.isError).toBeFalsy();
  });
});
