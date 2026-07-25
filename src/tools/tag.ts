/**
 * Tag Tools
 *
 * Tools for managing Komodo Tags (labels attached to resources for
 * filtering/grouping — category/tier/resource taxonomy, etc.).
 *
 * Tools (4):
 * - `komodo_tag_list`   — list registered tags
 * - `komodo_tag_info`   — full tag resource (tags are tiny — no resource-link offload)
 * - `komodo_tag_apply`  — create-or-update (discriminated by `action`)
 * - `komodo_tag_delete` — remove a tag (also detaches it from all resources)
 *
 * No reference-repo file to port from — `references/komodo-mcp-server`
 * never built this category (a real gap this project closes, not a
 * mechanical port). Modeled on `tools/alerter.ts`'s CRUD shape, the closest
 * existing analog. Every request/response shape below is verified against
 * `node_modules/komodo_client/dist/types.d.ts` (`Tag`, `TagColor`, `GetTag`,
 * `ListTags`, `CreateTag`, `RenameTag`, `UpdateTagColor`, `DeleteTag`).
 *
 * Unlike Alerter/Variable, there is no single generic "UpdateTag" write:
 * `RenameTag` and `UpdateTagColor` are two separate API calls. The `apply`
 * tool's update branch dispatches to one or both, sequentially, mirroring
 * `tools/variable.ts`'s multi-endpoint update dispatch pattern.
 *
 * @module tools/tag
 */

import { z } from "zod";
import { Types } from "komodo_client";
import { defineTool } from "../mcp/define-tool.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { ToolCategories, ToolScopes } from "../config/index.js";
import { AppErrorFactory } from "../errors/index.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { paginate } from "../utils/pagination.js";
import { buildApplyResult, buildDeleteResult } from "../utils/response-formatter.js";
import { renderTagList, renderTagInfo } from "./renderers/tag.js";
import { tagIdSchema, tagListOutputSchema, tagInfoOutputSchema, tagApplyInputSchema } from "./schemas/tag.js";
import { applyResultSchema, deleteResultSchema, paginationInputSchema } from "./schemas/shared.js";

type Tag = Types.Tag;

function projectTag(t: Tag): { id: string; name: string; owner?: string; color?: Types.TagColor } {
  return {
    id: t._id?.$oid ?? t.name,
    name: t.name,
    ...(t.owner !== undefined && t.owner !== "" ? { owner: t.owner } : {}),
    ...(t.color !== undefined ? { color: t.color } : {}),
  };
}

/**
 * `RenameTag`/`UpdateTagColor`/`DeleteTag` require the literal Mongo
 * ObjectId — confirmed live (passing a name fails with a Komodo 500,
 * "failed to rename tag on db"). Unlike most resources in this codebase,
 * Tag's write endpoints don't resolve name-or-id themselves, even though
 * `GetTag`/`ListTags` do. Resolve via `GetTag` first so the tool's `tag`
 * field can still accept either, matching every other domain's convention.
 */
async function resolveTagObjectId(tag: string): Promise<string> {
  const komodo = requireClient();
  const result = await wrapApiCall("getTag", () => komodo.client.read("GetTag", { tag }));
  return result._id?.$oid ?? tag;
}

// ============================================================================
// List
// ============================================================================

export const listTagsTool = defineTool({
  name: "komodo_tag_list",
  description: "List all tags registered in Komodo. Tags are labels attached to resources for filtering/grouping.",
  input: paginationInputSchema,
  output: tagListOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.TAG },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const tags = await wrapApiCall("listTags", () => komodo.client.read("ListTags", {}));
    const allItems = tags.map(projectTag);
    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderTagList(payload) });
  },
});

registerToolDefinition(listTagsTool);

// ============================================================================
// Info
// ============================================================================

export const getTagInfoTool = defineTool({
  name: "komodo_tag_info",
  description: "Get the full Komodo Tag resource (id, name, owner, color). Tags are small — always returned inline.",
  input: z.object({
    tag: tagIdSchema.describe("Tag id or name"),
  }),
  output: tagInfoOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.TAG },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("getTag", () => komodo.client.read("GetTag", { tag: args.tag }));
    const payload = { tag: projectTag(result) };
    return structuredResult(payload, { text: renderTagInfo(payload) });
  },
});

registerToolDefinition(getTagInfoTool);

// ============================================================================
// CRUD
// ============================================================================

export const applyTagTool = defineTool({
  name: "komodo_tag_apply",
  description: [
    "Create or update a Komodo Tag. Tags label resources for filtering/grouping.",
    'action="create": new tag. Required: name. Optional: color (default: Slate).',
    'action="update": existing tag (`tag` required). Provide `name` to rename and/or `color` to recolor — at least one is required; each triggers its own API call (RenameTag / UpdateTagColor — there is no combined update endpoint).',
  ].join("\n"),
  input: tagApplyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.TAG },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "create") {
      if (!args.name) throw AppErrorFactory.validation.fieldRequired("name");
      const name = args.name;
      const params: Types.CreateTag = {
        name,
        ...(args.color !== undefined && { color: args.color }),
      };
      const result = await wrapApiCall("createTag", () => komodo.client.write("CreateTag", params));
      const built = buildApplyResult("create", "tag", name, result);
      return structuredResult(built.payload, { text: built.text });
    }
    // update — dispatch to one or both endpoints based on which fields are set
    if (!args.tag) throw AppErrorFactory.validation.fieldRequired("tag");
    if (args.name === undefined && args.color === undefined) {
      throw AppErrorFactory.validation.fieldRequired("name | color");
    }
    const tagId = await resolveTagObjectId(args.tag);
    let updated: Tag | undefined;
    if (args.name !== undefined) {
      const name = args.name;
      updated = await wrapApiCall("renameTag", () => komodo.client.write("RenameTag", { id: tagId, name }));
    }
    if (args.color !== undefined) {
      const color = args.color;
      updated = await wrapApiCall("updateTagColor", () => komodo.client.write("UpdateTagColor", { tag: tagId, color }));
    }
    const built = buildApplyResult("update", "tag", args.tag, updated);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(applyTagTool);

export const deleteTagTool = defineTool({
  name: "komodo_tag_delete",
  description: "Delete a Komodo Tag. Also removes this tag from every resource it was attached to.",
  input: z.object({
    tag: tagIdSchema.describe("Tag id or name to delete"),
  }),
  output: deleteResultSchema,
  annotations: { destructiveHint: true },
  guardrail: "destructive",
  _meta: { category: ToolCategories.TAG },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const tagId = await resolveTagObjectId(args.tag);
    const result = await wrapApiCall("deleteTag", () => komodo.client.write("DeleteTag", { id: tagId }));
    const built = buildDeleteResult("tag", args.tag, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(deleteTagTool);
