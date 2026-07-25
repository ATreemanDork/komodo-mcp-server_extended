/**
 * UserGroup Tools
 *
 * Tools for managing Komodo UserGroups — named groups of Users that can be
 * granted permissions collectively (see `komodo_permission_*`, the sibling
 * domain), optionally applying to every user via `everyone`.
 *
 * Tools (6):
 * - `komodo_user_group_list`        — list registered user groups
 * - `komodo_user_group_info`        — full user group resource (small — no resource-link offload)
 * - `komodo_user_group_apply`       — create-or-rename (discriminated by `action`)
 * - `komodo_user_group_delete`      — remove a user group
 * - `komodo_user_group_set_everyone` — toggle whether the group implicitly applies to every user
 * - `komodo_user_group_set_users`   — add/remove one member, or hard-set the full member list
 *
 * No reference-repo file to port from — `references/komodo-mcp-server`
 * never built this category (a real gap this project closes, not a
 * mechanical port). Every request/response shape verified against
 * `node_modules/komodo_client/dist/types.d.ts` (`UserGroup`,
 * `ListUserGroups`, `GetUserGroup`, `CreateUserGroup`, `RenameUserGroup`,
 * `DeleteUserGroup`, `AddUserToUserGroup`, `RemoveUserFromUserGroup`,
 * `SetUsersInUserGroup`, `SetEveryoneUserGroup`).
 *
 * `RenameUserGroup`/`DeleteUserGroup` require the literal Mongo ObjectId —
 * confirmed live (passing a plain name fails with a Komodo 500, "failed to
 * rename UserGroup on db" / "failed to query db for UserGroups", both
 * tracing to "id is not [a] valid ObjectId"). Same asymmetry `tools/tag.ts`
 * hit with `RenameTag`/`DeleteTag` (`GetUserGroup`/`AddUserToUserGroup`/etc
 * accept name-or-id; these two don't). Resolved the same way: look the
 * group up via `GetUserGroup` first so the tool's own `user_group` field
 * can still accept either, matching every other domain's convention.
 *
 * @module tools/user-group
 */

import { z } from "zod";
import { Types } from "komodo_client";
import { defineTool } from "../mcp/define-tool.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { ToolCategories, ToolScopes } from "../config/index.js";
import { AppErrorFactory } from "../errors/index.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { buildApplyResult, buildDeleteResult } from "../utils/response-formatter.js";
import { renderUserGroupList, renderUserGroupInfo } from "./renderers/user-group.js";
import {
  userGroupIdSchema,
  userGroupListOutputSchema,
  userGroupInfoOutputSchema,
  userGroupApplyInputSchema,
  userGroupSetEveryoneInputSchema,
  userGroupSetUsersInputSchema,
} from "./schemas/user-group.js";
import { applyResultSchema, deleteResultSchema } from "./schemas/shared.js";

type UserGroup = Types.UserGroup;

function projectUserGroup(g: UserGroup): { id: string; name: string; everyone?: boolean; users?: string[] } {
  return {
    id: g._id?.$oid ?? g.name,
    name: g.name,
    ...(g.everyone !== undefined && { everyone: g.everyone }),
    ...(g.users !== undefined && { users: g.users }),
  };
}

/**
 * `RenameUserGroup`/`DeleteUserGroup` require the literal Mongo ObjectId —
 * confirmed live, see the module-level note above. Resolve via
 * `GetUserGroup` first so the tool's `user_group` field can still accept
 * either, matching every other domain's convention.
 */
async function resolveUserGroupObjectId(userGroup: string): Promise<string> {
  const komodo = requireClient();
  const result = await wrapApiCall("getUserGroup", () => komodo.client.read("GetUserGroup", { user_group: userGroup }));
  return result._id?.$oid ?? userGroup;
}

// ============================================================================
// List
// ============================================================================

export const listUserGroupsTool = defineTool({
  name: "komodo_user_group_list",
  description:
    "List all UserGroups registered in Komodo. Admins see every group; non-admin users see only the groups they belong to.",
  input: z.object({}),
  output: userGroupListOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.USER_GROUP },
  requiredScopes: [ToolScopes.READ],
  handler: async () => {
    const komodo = requireClient();
    const groups = await wrapApiCall("listUserGroups", () => komodo.client.read("ListUserGroups", {}));
    const payload = { items: groups.map(projectUserGroup) };
    return structuredResult(payload, { text: renderUserGroupList(payload) });
  },
});

registerToolDefinition(listUserGroupsTool);

// ============================================================================
// Info
// ============================================================================

export const getUserGroupInfoTool = defineTool({
  name: "komodo_user_group_info",
  description: "Get the full Komodo UserGroup resource (id, name, everyone flag, member user ids).",
  input: z.object({
    user_group: userGroupIdSchema.describe("UserGroup id or name"),
  }),
  output: userGroupInfoOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.USER_GROUP },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("getUserGroup", () =>
      komodo.client.read("GetUserGroup", { user_group: args.user_group }),
    );
    const payload = { user_group: projectUserGroup(result) };
    return structuredResult(payload, { text: renderUserGroupInfo(payload) });
  },
});

registerToolDefinition(getUserGroupInfoTool);

// ============================================================================
// CRUD
// ============================================================================

export const applyUserGroupTool = defineTool({
  name: "komodo_user_group_apply",
  description: [
    "Create or rename a Komodo UserGroup. **Admin only.**",
    'action="create": new group. Required: name.',
    'action="update": rename an existing group (`user_group` required). Required: name (the new name).',
  ].join("\n"),
  input: userGroupApplyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.USER_GROUP },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "create") {
      const result = await wrapApiCall("createUserGroup", () =>
        komodo.client.write("CreateUserGroup", { name: args.name }),
      );
      const built = buildApplyResult("create", "user_group", args.name, result);
      return structuredResult(built.payload, { text: built.text });
    }
    // update — rename
    if (!args.user_group) throw AppErrorFactory.validation.fieldRequired("user_group");
    const groupId = await resolveUserGroupObjectId(args.user_group);
    const result = await wrapApiCall("renameUserGroup", () =>
      komodo.client.write("RenameUserGroup", { id: groupId, name: args.name }),
    );
    const built = buildApplyResult("update", "user_group", args.user_group, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(applyUserGroupTool);

export const deleteUserGroupTool = defineTool({
  name: "komodo_user_group_delete",
  description: "Delete a Komodo UserGroup. **Admin only.** Members are not affected; only the group itself is removed.",
  input: z.object({
    user_group: userGroupIdSchema.describe("UserGroup id or name to delete"),
  }),
  output: deleteResultSchema,
  annotations: { destructiveHint: true },
  guardrail: "destructive",
  _meta: { category: ToolCategories.USER_GROUP },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const groupId = await resolveUserGroupObjectId(args.user_group);
    const result = await wrapApiCall("deleteUserGroup", () => komodo.client.write("DeleteUserGroup", { id: groupId }));
    const built = buildDeleteResult("user_group", args.user_group, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(deleteUserGroupTool);

// ============================================================================
// Everyone flag
// ============================================================================

export const setUserGroupEveryoneTool = defineTool({
  name: "komodo_user_group_set_everyone",
  description: "Set whether a Komodo UserGroup's permissions implicitly apply to every user. **Admin only.**",
  input: userGroupSetEveryoneInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: true },
  _meta: { category: ToolCategories.USER_GROUP },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("setEveryoneUserGroup", () =>
      komodo.client.write("SetEveryoneUserGroup", { user_group: args.user_group, everyone: args.everyone }),
    );
    const built = buildApplyResult("update", "user_group", args.user_group, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(setUserGroupEveryoneTool);

// ============================================================================
// Membership
// ============================================================================

export const setUserGroupUsersTool = defineTool({
  name: "komodo_user_group_set_users",
  description: [
    "Manage a Komodo UserGroup's membership. **Admin only.**",
    'action="add": add one user (`user` required, id or username).',
    'action="remove": remove one user (`user` required, id or username).',
    'action="set": hard-override the full member list (`users` required, ids or usernames).',
  ].join("\n"),
  input: userGroupSetUsersInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.USER_GROUP },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    let result: UserGroup;
    if (args.action === "add") {
      if (!args.user) throw AppErrorFactory.validation.fieldRequired("user");
      result = await wrapApiCall("addUserToUserGroup", () =>
        komodo.client.write("AddUserToUserGroup", { user_group: args.user_group, user: args.user as string }),
      );
    } else if (args.action === "remove") {
      if (!args.user) throw AppErrorFactory.validation.fieldRequired("user");
      result = await wrapApiCall("removeUserFromUserGroup", () =>
        komodo.client.write("RemoveUserFromUserGroup", { user_group: args.user_group, user: args.user as string }),
      );
    } else {
      if (!args.users) throw AppErrorFactory.validation.fieldRequired("users");
      result = await wrapApiCall("setUsersInUserGroup", () =>
        komodo.client.write("SetUsersInUserGroup", { user_group: args.user_group, users: args.users as string[] }),
      );
    }
    const built = buildApplyResult("update", "user_group", args.user_group, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(setUserGroupUsersTool);
