/**
 * Read-only domains — integration test (real Komodo instance)
 * Toml, Docker introspection, Server, Swarm, Update — no create/mutate,
 * nothing to clean up. Server/Swarm deliberately stay read-only here per
 * the operator's own exception (no automated server/swarm create-delete).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startIntegrationClient, call, TEST_SERVER_ID, type IntegrationClient } from "./helpers.js";

describe.skipIf(!process.env["KOMODO_URL"] || !process.env["KOMODO_TEST_SERVER_ID"])("Read-only domains (integration)", () => {
  let ctx: IntegrationClient;

  beforeAll(async () => {
    ctx = await startIntegrationClient();
  });

  afterAll(async () => {
    await ctx.stop();
  });

  it("komodo_toml_export_all", async () => {
    const res = await call(ctx.client, "komodo_toml_export_all", {});
    expect(res.isError).toBeFalsy();
    expect(typeof res.structuredContent?.["toml"]).toBe("string");
  });

  it("komodo_toml_export_resources (single server target)", async () => {
    const res = await call(ctx.client, "komodo_toml_export_resources", {
      targets: [{ type: "Server", id: TEST_SERVER_ID }],
    });
    expect(res.isError).toBeFalsy();
  });

  it("komodo_docker_image_list / network_list / volume_list", async () => {
    for (const tool of ["komodo_docker_image_list", "komodo_docker_network_list", "komodo_docker_volume_list"]) {
      const res = await call(ctx.client, tool, { server: TEST_SERVER_ID });
      expect(res.isError, `${tool} failed: ${res.text}`).toBeFalsy();
    }
  });

  it("komodo_server_list / info / stats", async () => {
    expect((await call(ctx.client, "komodo_server_list")).isError).toBeFalsy();
    expect((await call(ctx.client, "komodo_server_info", { server: TEST_SERVER_ID })).isError).toBeFalsy();
    expect((await call(ctx.client, "komodo_server_stats", { server: TEST_SERVER_ID })).isError).toBeFalsy();
  });

  it("komodo_swarm_list / info (this instance may have zero swarms — that's a valid, non-error result)", async () => {
    const res = await call(ctx.client, "komodo_swarm_list");
    expect(res.isError).toBeFalsy();
  });

  it("komodo_update_list / info", async () => {
    const list = await call(ctx.client, "komodo_update_list");
    expect(list.isError).toBeFalsy();
    const items = (list.structuredContent?.["items"] as Array<Record<string, unknown>> | undefined) ?? [];
    if (items.length > 0 && items[0]) {
      const id = items[0]["id"] as string;
      const info = await call(ctx.client, "komodo_update_info", { id });
      expect(info.isError).toBeFalsy();
    }
  });

  it("komodo_user_list_api_keys", async () => {
    const res = await call(ctx.client, "komodo_user_list_api_keys");
    expect(res.isError).toBeFalsy();
  });
});
