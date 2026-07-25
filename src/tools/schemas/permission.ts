/**
 * Permission Schemas
 *
 * Zod schemas for Komodo's RBAC surface (`komodo_permission_*` tools) — the
 * matrix of which User / UserGroup has which `PermissionLevel` (+ optional
 * `SpecificPermission`s) on which resource, or resource type, plus a user's
 * base account-level flags.
 *
 * No reference-repo file to port from — `references/komodo-mcp-server`
 * never built this category (documented as inert/no-op there). Every field
 * verified against `node_modules/komodo_client/dist/types.d.ts`
 * (`PermissionLevel`, `SpecificPermission`, `PermissionLevelAndSpecifics`,
 * `UserTarget`, `ResourceTarget`, `Permission`, `GetPermission`,
 * `ListPermissions`, `ListUserTargetPermissions`,
 * `UpdatePermissionOnTarget`, `UpdatePermissionOnResourceType`,
 * `UpdateUserBasePermissions`).
 *
 * This is the most irregular of these categories — not a CRUD
 * resource. `resource_target` reuses `tools/schemas/provider.ts`'s existing
 * loose `resourceTargetSchema` ({type, id} as plain strings) rather than a
 * second, stricter definition, per the reuse-before-reinventing precedent
 * these schemas already follow. `user_target` gets its own strict 2-variant
 * schema here since `UserTarget` genuinely is only ever "User" or
 * "UserGroup" — worth constraining, unlike the 12-variant `ResourceTarget`.
 *
 * @module tools/schemas/permission
 */

import { z } from "zod";
import { resourceTargetSchema } from "./provider.js";

export { resourceTargetSchema };

/** `Types.PermissionLevel` — the coarse permission tier on a resource. */
export const permissionLevelSchema = z
  .enum(["None", "Read", "Execute", "Write"])
  .describe("Coarse permission tier: None, Read, Execute, or Write");

/** `Types.SpecificPermission` — finer-grained capabilities layered on top of a level. */
export const specificPermissionSchema = z
  .enum(["Terminal", "Attach", "Inspect", "Logs", "Processes"])
  .describe(
    "Specific capability: Terminal (server terminal / container exec), Attach (attach child resources), " +
      "Inspect (container inspect), Logs (container logs), Processes (host process list)",
  );

/** `Types.UserTarget` — a User or UserGroup being granted/queried for permissions. */
export const userTargetSchema = z
  .object({
    type: z.enum(["User", "UserGroup"]).describe("Whether this target is a single User or a UserGroup"),
    id: z.string().describe("The User id or UserGroup id"),
  })
  .describe("Komodo `UserTarget` — a User or UserGroup");

/** `Types.ResourceTarget["type"]` — the 12 resource types Permission can scope to. */
export const resourceTargetTypeSchema = z
  .enum([
    "System",
    "Swarm",
    "Server",
    "Stack",
    "Deployment",
    "Build",
    "Repo",
    "Procedure",
    "Action",
    "Builder",
    "Alerter",
    "ResourceSync",
  ])
  .describe("Komodo resource type");

/** `Types.PermissionLevelAndSpecifics` — the level + specific-permission bundle sent on writes. */
export const permissionGrantSchema = z.object({
  level: permissionLevelSchema,
  specific: z.array(specificPermissionSchema).optional().describe("Additional specific permissions. Default: none."),
});

// ============================================================================
// Output shapes
// ============================================================================

/** Output of `komodo_permission_get`. */
export const permissionGetOutputSchema = z
  .object({
    target: resourceTargetSchema,
    level: permissionLevelSchema,
    specific: z.array(specificPermissionSchema),
  })
  .describe("The calling user's effective permission level + specifics on a resource");

/** A single `Types.Permission` entry, as returned by `ListPermissions`/`ListUserTargetPermissions`. */
export const permissionEntrySchema = z.object({
  id: z.string().optional().describe("Permission document id"),
  user_target: userTargetSchema,
  resource_target: resourceTargetSchema,
  level: permissionLevelSchema.optional(),
  specific: z.array(specificPermissionSchema).optional(),
});

/** Output of `komodo_permission_list` / `komodo_permission_list_for_target`. */
export const permissionListOutputSchema = z
  .object({
    items: z.array(permissionEntrySchema),
  })
  .describe("Permission documents");

/** Output of the three `komodo_permission_update_*` tools. */
export const permissionUpdateOutputSchema = z
  .object({
    updated: z.literal(true),
    user_target: userTargetSchema.optional(),
    resource_target: resourceTargetSchema.optional(),
    resource_type: resourceTargetTypeSchema.optional(),
    permission: permissionGrantSchema.optional(),
    user_id: z.string().optional(),
    enabled: z.boolean().optional(),
    create_servers: z.boolean().optional(),
    create_builds: z.boolean().optional(),
  })
  .describe("Confirmation of a permission update (the API itself returns no data)");

// ============================================================================
// Input shapes
// ============================================================================

/** Input for `komodo_permission_get`. */
export const permissionGetInputSchema = z.object({
  target: resourceTargetSchema.describe("The resource to check the calling user's permission level on"),
});

/** Input for `komodo_permission_list_for_target`. */
export const permissionListForTargetInputSchema = z.object({
  user_target: userTargetSchema.describe("The User or UserGroup to list permissions for"),
});

/** Input for `komodo_permission_update_on_target`. */
export const permissionUpdateOnTargetInputSchema = z.object({
  user_target: userTargetSchema.describe("The User or UserGroup being granted the permission"),
  resource_target: resourceTargetSchema.describe("The specific resource to grant permission on"),
  level: permissionLevelSchema,
  specific: z.array(specificPermissionSchema).optional().describe("Additional specific permissions. Default: none."),
});

/** Input for `komodo_permission_update_on_resource_type`. */
export const permissionUpdateOnResourceTypeInputSchema = z.object({
  user_target: userTargetSchema.describe("The User or UserGroup being granted the permission"),
  resource_type: resourceTargetTypeSchema.describe("The resource type to grant blanket permission across"),
  level: permissionLevelSchema,
  specific: z.array(specificPermissionSchema).optional().describe("Additional specific permissions. Default: none."),
});

/** Input for `komodo_permission_update_user_base`. */
export const permissionUpdateUserBaseInputSchema = z.object({
  user_id: z.string().min(1).describe("The target user's id"),
  enabled: z.boolean().optional().describe("If set, updates whether the user's account is enabled"),
  create_servers: z.boolean().optional().describe("If set, updates whether the user may create Server resources"),
  create_builds: z.boolean().optional().describe("If set, updates whether the user may create Build resources"),
});
