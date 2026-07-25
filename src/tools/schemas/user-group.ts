/**
 * UserGroup Schemas
 *
 * Zod schemas for Komodo `UserGroup` resources (`komodo_user_group_*`
 * tools) — a named group of Users that can be granted permissions
 * collectively, optionally applying to every user via `everyone`.
 *
 * No reference-repo file to port from — `references/komodo-mcp-server`
 * never built this category. Every field verified against
 * `node_modules/komodo_client/dist/types.d.ts` (`Types.UserGroup`,
 * `CreateUserGroup`, `RenameUserGroup`, `DeleteUserGroup`,
 * `AddUserToUserGroup`, `RemoveUserFromUserGroup`, `SetUsersInUserGroup`,
 * `SetEveryoneUserGroup`). Modeled structurally on `tools/schemas/tag.ts`
 * (small resource, no resource-link offload, apply collapses two distinct
 * write endpoints).
 *
 * @module tools/schemas/user-group
 */

import { z } from "zod";
import { resourceNameSchema } from "./validators.js";

/** UserGroup identifier (id or name) accepted by the Komodo API. */
export const userGroupIdSchema = z.string().min(1);

/** Full projected UserGroup shape used by both list and info tools. */
export const userGroupSummarySchema = z.object({
  id: z.string().describe("UserGroup id"),
  name: z.string().describe("UserGroup name"),
  everyone: z.boolean().optional().describe("Whether this group implicitly includes every user"),
  users: z.array(z.string()).optional().describe("User ids that are members of this group"),
});

/** Output of `komodo_user_group_list`. */
export const userGroupListOutputSchema = z
  .object({
    items: z.array(userGroupSummarySchema).describe("UserGroups registered in Komodo"),
  })
  .describe("List of registered user groups");

/** Output of `komodo_user_group_info`. */
export const userGroupInfoOutputSchema = z
  .object({
    user_group: userGroupSummarySchema,
  })
  .describe("Full UserGroup resource");

/**
 * Input for `komodo_user_group_apply` (create-or-rename).
 *
 * Like Tag, there is no combined "update everything" endpoint — `name` is
 * the only field `RenameUserGroup` covers. Membership (`set_users`) and the
 * `everyone` flag are separate tools, matching their own distinct API
 * endpoints.
 */
export const userGroupApplyInputSchema = z.object({
  action: z
    .enum(["create", "update"])
    .describe("'create' to register a new user group, 'update' to rename an existing one"),
  user_group: userGroupIdSchema.optional().describe("Required when action='update' — existing user group id or name"),
  name: resourceNameSchema.describe("Required for both actions: the name to assign (create) or rename to (update)"),
});

/** Input for `komodo_user_group_set_everyone`. */
export const userGroupSetEveryoneInputSchema = z.object({
  user_group: userGroupIdSchema.describe("UserGroup id or name"),
  everyone: z.boolean().describe("Whether this group's permissions should implicitly apply to every user"),
});

/**
 * Input for `komodo_user_group_set_users` — collapses `AddUserToUserGroup` /
 * `RemoveUserFromUserGroup` / `SetUsersInUserGroup` into one tool,
 * discriminated by `action`.
 */
export const userGroupSetUsersInputSchema = z.object({
  action: z
    .enum(["add", "remove", "set"])
    .describe("'add'/'remove' one user, or 'set' to hard-override the full member list"),
  user_group: userGroupIdSchema.describe("UserGroup id or name"),
  user: z.string().optional().describe("Required for action='add'/'remove' — the id or username of the user"),
  users: z
    .array(z.string())
    .optional()
    .describe("Required for action='set' — the full list of user ids or usernames to hard-set as members"),
});
