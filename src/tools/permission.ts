/**
 * Permission Tools
 *
 * Tools for Komodo's RBAC surface — which User / UserGroup has which
 * `PermissionLevel` (+ optional `SpecificPermission`s) on which resource or
 * resource type, plus a user's base account-level flags (enabled, may
 * create servers/builds).
 *
 * Tools (6):
 * - `komodo_permission_get`                    — the calling user's own effective level on a resource
 * - `komodo_permission_list`                    — **Admin only.** every Permission document in the system
 * - `komodo_permission_list_for_target`         — **Admin only.** every Permission document for one User/UserGroup
 * - `komodo_permission_update_on_target`        — **Admin only.** grant a level on one specific resource
 * - `komodo_permission_update_on_resource_type` — **Admin only.** grant a blanket level across a whole resource type
 * - `komodo_permission_update_user_base`        — **Admin only.** toggle a user's enabled/create-servers/create-builds flags
 *
 * No reference-repo file to port from — `references/komodo-mcp-server`
 * documents its own RBAC layer as inert/no-op and never modeled this
 * category. This is the most irregular of these categories (an RBAC
 * matrix, not a CRUD resource) — built directly per the
 * approach confirmed with the operator. Every request/
 * response shape verified against `node_modules/komodo_client/dist/
 * types.d.ts` (`GetPermission`, `ListPermissions`,
 * `ListUserTargetPermissions`, `UpdatePermissionOnTarget`,
 * `UpdatePermissionOnResourceType`, `UpdateUserBasePermissions`).
 *
 * The three `update_*` writes all respond with Komodo's `NoData` (an empty
 * object) — there is nothing to echo back from the API, so each tool builds
 * its own confirmation payload from the request it just sent, rather than
 * reusing `buildApplyResult`/`buildDeleteResult` (which assume the API
 * returns the affected resource).
 *
 * @module tools/permission
 */

import { z } from "zod";
import type { Types } from "komodo_client";
import { defineTool } from "../mcp/define-tool.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { ToolCategories, ToolScopes } from "../config/index.js";
import { AppErrorFactory } from "../errors/index.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { renderPermissionGet, renderPermissionList, renderPermissionUpdate } from "./renderers/permission.js";
import {
  permissionGetInputSchema,
  permissionGetOutputSchema,
  permissionListOutputSchema,
  permissionListForTargetInputSchema,
  permissionUpdateOnTargetInputSchema,
  permissionUpdateOnResourceTypeInputSchema,
  permissionUpdateUserBaseInputSchema,
  permissionUpdateOutputSchema,
} from "./schemas/permission.js";

type Permission = Types.Permission;

function projectPermission(p: Permission): {
  id?: string;
  user_target: Types.UserTarget;
  resource_target: Types.ResourceTarget;
  level?: Types.PermissionLevel;
  specific?: Types.SpecificPermission[];
} {
  return {
    ...(p._id?.$oid !== undefined && { id: p._id.$oid }),
    user_target: p.user_target,
    resource_target: p.resource_target,
    ...(p.level !== undefined && { level: p.level }),
    ...(p.specific !== undefined && { specific: p.specific }),
  };
}

// ============================================================================
// Get (self)
// ============================================================================

export const getPermissionTool = defineTool({
  name: "komodo_permission_get",
  description:
    "Get the calling user's own effective permission level (+ specifics) on a resource. Factors in any UserGroup memberships.",
  input: permissionGetInputSchema,
  output: permissionGetOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.PERMISSION },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("getPermission", () =>
      komodo.client.read("GetPermission", { target: args.target as Types.ResourceTarget }),
    );
    const payload = { target: args.target, level: result.level, specific: result.specific };
    return structuredResult(payload, { text: renderPermissionGet(payload) });
  },
});

registerToolDefinition(getPermissionTool);

// ============================================================================
// List
// ============================================================================

export const listPermissionsTool = defineTool({
  name: "komodo_permission_list",
  description:
    "List every Permission document in the system — every User/UserGroup grant on every resource. **Admin only.**",
  input: z.object({}),
  output: permissionListOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.PERMISSION },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async () => {
    const komodo = requireClient();
    const permissions = await wrapApiCall("listPermissions", () => komodo.client.read("ListPermissions", {}));
    const payload = { items: permissions.map(projectPermission) };
    return structuredResult(payload, { text: renderPermissionList(payload) });
  },
});

registerToolDefinition(listPermissionsTool);

export const listUserTargetPermissionsTool = defineTool({
  name: "komodo_permission_list_for_target",
  description: "List every Permission document granted to one specific User or UserGroup. **Admin only.**",
  input: permissionListForTargetInputSchema,
  output: permissionListOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.PERMISSION },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const permissions = await wrapApiCall("listUserTargetPermissions", () =>
      komodo.client.read("ListUserTargetPermissions", { user_target: args.user_target }),
    );
    const payload = { items: permissions.map(projectPermission) };
    return structuredResult(payload, { text: renderPermissionList(payload) });
  },
});

registerToolDefinition(listUserTargetPermissionsTool);

// ============================================================================
// Update
// ============================================================================

export const updatePermissionOnTargetTool = defineTool({
  name: "komodo_permission_update_on_target",
  description:
    "Grant a User/UserGroup a permission level (+ optional specifics) on one specific resource. **Admin only.**",
  input: permissionUpdateOnTargetInputSchema,
  output: permissionUpdateOutputSchema,
  annotations: { idempotentHint: true },
  guardrail: "critical",
  _meta: { category: ToolCategories.PERMISSION },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const specific = args.specific ?? [];
    await wrapApiCall("updatePermissionOnTarget", () =>
      komodo.client.write("UpdatePermissionOnTarget", {
        user_target: args.user_target,
        resource_target: args.resource_target as Types.ResourceTarget,
        permission: { level: args.level as Types.PermissionLevel, specific: specific as Types.SpecificPermission[] },
      }),
    );
    const payload = {
      updated: true as const,
      user_target: args.user_target,
      resource_target: args.resource_target,
      permission: { level: args.level, specific },
    };
    return structuredResult(payload, { text: renderPermissionUpdate(payload) });
  },
});

registerToolDefinition(updatePermissionOnTargetTool);

export const updatePermissionOnResourceTypeTool = defineTool({
  name: "komodo_permission_update_on_resource_type",
  description:
    "Grant a User/UserGroup a blanket permission level (+ optional specifics) across every resource of one type " +
    '(e.g. every Stack). Use resource_type="System" for server-wide/system-level access. **Admin only.** ' +
    "Confirmed live: this writes into the target's own `all` map (visible via komodo_user_group_info / the " +
    "user's record), a separate mechanism from the per-resource grants komodo_permission_list/list_for_target " +
    "read — a resource-type grant will NOT show up in those two tools' output.",
  input: permissionUpdateOnResourceTypeInputSchema,
  output: permissionUpdateOutputSchema,
  annotations: { idempotentHint: true },
  guardrail: "critical",
  _meta: { category: ToolCategories.PERMISSION },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const specific = args.specific ?? [];
    await wrapApiCall("updatePermissionOnResourceType", () =>
      komodo.client.write("UpdatePermissionOnResourceType", {
        user_target: args.user_target,
        resource_type: args.resource_type,
        permission: { level: args.level as Types.PermissionLevel, specific: specific as Types.SpecificPermission[] },
      }),
    );
    const payload = {
      updated: true as const,
      user_target: args.user_target,
      resource_type: args.resource_type,
      permission: { level: args.level, specific },
    };
    return structuredResult(payload, { text: renderPermissionUpdate(payload) });
  },
});

registerToolDefinition(updatePermissionOnResourceTypeTool);

export const updateUserBasePermissionsTool = defineTool({
  name: "komodo_permission_update_user_base",
  description:
    "Update a user's base account-level flags: enabled, and whether they may create Server/Build resources directly. " +
    "**Admin only** for one's own non-admin targets; **Super Admin only** when the target user is itself an admin " +
    '(confirmed live: a plain admin credential gets a real 500, "Only super admins can use this method to update ' +
    'other admins permissions"). At least one flag must be provided.',
  input: permissionUpdateUserBaseInputSchema,
  output: permissionUpdateOutputSchema,
  annotations: { idempotentHint: true },
  guardrail: "critical",
  _meta: { category: ToolCategories.PERMISSION },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    if (args.enabled === undefined && args.create_servers === undefined && args.create_builds === undefined) {
      throw AppErrorFactory.validation.fieldRequired("enabled | create_servers | create_builds");
    }
    const komodo = requireClient();
    await wrapApiCall("updateUserBasePermissions", () =>
      komodo.client.write("UpdateUserBasePermissions", {
        user_id: args.user_id,
        ...(args.enabled !== undefined && { enabled: args.enabled }),
        ...(args.create_servers !== undefined && { create_servers: args.create_servers }),
        ...(args.create_builds !== undefined && { create_builds: args.create_builds }),
      }),
    );
    const payload = {
      updated: true as const,
      user_id: args.user_id,
      ...(args.enabled !== undefined && { enabled: args.enabled }),
      ...(args.create_servers !== undefined && { create_servers: args.create_servers }),
      ...(args.create_builds !== undefined && { create_builds: args.create_builds }),
    };
    return structuredResult(payload, { text: renderPermissionUpdate(payload) });
  },
});

registerToolDefinition(updateUserBasePermissionsTool);
