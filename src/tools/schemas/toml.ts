/**
 * Toml Schemas
 *
 * Zod schemas for Komodo's sync-TOML export API (`komodo_toml_*` tools) —
 * export-only, no import counterpart exists (that's what the already-ported
 * `komodo_resource_sync_*` domain is for: syncs pull TOML from a git repo).
 *
 * No reference-repo file to port from. Every field verified against
 * `node_modules/komodo_client/dist/types.d.ts` (`TomlResponse`,
 * `ExportAllResourcesToToml`, `ExportResourcesToToml`). Both requests also
 * accept an `existing?: ResourcesToml` field to preserve meta configuration
 * when re-exporting — deliberately not exposed here: `ResourcesToml` mirrors
 * the full partial-config shape of every resource type in this codebase
 * (`_PartialStackConfig`, `_PartialServerConfig`, ...), and the field exists
 * to let a caller merge onto an export they already have in hand, which an
 * MCP tool call has no natural way to hold across a single request anyway.
 *
 * @module tools/schemas/toml
 */

import { z } from "zod";
import { resourceTargetSchema } from "./provider.js";

/** `Types.TomlResponse` — both export tools return this shape. */
export const tomlOutputSchema = z
  .object({
    toml: z.string().describe("The exported resources, rendered as sync TOML"),
  })
  .describe("Exported sync TOML contents");

/** Input for `komodo_toml_export_all`. */
export const tomlExportAllInputSchema = z.object({
  include_resources: z
    .boolean()
    .optional()
    .describe("Whether to include resources (servers, stacks, etc.) in the export. Default: true"),
  tags: z.array(z.string()).optional().describe("Filter resources by tag name or id. Empty/omitted = no tag filter."),
  include_variables: z.boolean().optional().describe("Whether to include variables in the export. Default: false"),
  include_user_groups: z.boolean().optional().describe("Whether to include user groups in the export. Default: false"),
});

/** Input for `komodo_toml_export_resources`. */
export const tomlExportResourcesInputSchema = z.object({
  targets: z.array(resourceTargetSchema).optional().describe("Specific resources to include in the export"),
  user_groups: z.array(z.string()).optional().describe("User group names or ids to include in the export"),
  include_variables: z.boolean().optional().describe("Whether to include variables in the export. Default: false"),
});
