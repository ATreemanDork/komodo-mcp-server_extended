/**
 * Response Formatter — unit tests.
 * Used by every `*_apply`/`*_delete` tool across all 25+ domains — one bug
 * here silently breaks a lot of tools at once.
 */

import { describe, it, expect } from "vitest";
import { formatActionResponse, buildApplyResult, buildDeleteResult } from "../../../src/utils/response-formatter.js";

describe("formatActionResponse", () => {
  it("includes the resource label, action, and id", () => {
    const text = formatActionResponse({ action: "start", resourceType: "container", resourceId: "web-1" });
    expect(text).toContain("Container");
    expect(text).toContain("web-1");
    expect(text).toContain("started");
  });

  it("appends the server name when given", () => {
    const text = formatActionResponse({
      action: "deploy",
      resourceType: "stack",
      resourceId: "s1",
      serverName: "prod-1",
    });
    expect(text).toContain('on server "prod-1"');
  });

  it("appends update id / status details when given", () => {
    const text = formatActionResponse({
      action: "stop",
      resourceType: "deployment",
      resourceId: "d1",
      updateId: "abc123",
      status: "Complete",
    });
    expect(text).toContain("Update ID: abc123");
    expect(text).toContain("Status: Complete");
  });
});

describe("buildApplyResult", () => {
  it("builds a create payload with the resource attached", () => {
    const { payload, text } = buildApplyResult("create", "tag", "my-tag", { name: "my-tag", color: "Blue" });
    expect(payload).toMatchObject({ action: "create", resource_type: "tag", resource_id: "my-tag" });
    expect(payload.resource).toMatchObject({ name: "my-tag", color: "Blue" });
    expect(text).toContain("my-tag");
  });

  it("omits the resource field when the API result isn't an object", () => {
    const { payload } = buildApplyResult("update", "tag", "my-tag", undefined);
    expect(payload.resource).toBeUndefined();
  });
});

describe("buildDeleteResult", () => {
  it("builds a remove payload", () => {
    const { payload, text } = buildDeleteResult("variable", "my-var", { name: "my-var" });
    expect(payload).toMatchObject({ action: "remove", resource_type: "variable", resource_id: "my-var" });
    expect(text).toContain("removed");
  });
});
