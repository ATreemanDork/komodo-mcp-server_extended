/**
 * Toml Tools
 *
 * Export-only tools for Komodo's sync-TOML format — the same format
 * `komodo_resource_sync_*` reads from a git repo. There is no import
 * counterpart in the API; ResourceSync is how TOML gets applied back.
 *
 * Tools (2):
 * - `komodo_toml_export_all`       — export every resource the caller can view (with filters)
 * - `komodo_toml_export_resources` — export a specific set of resources/user groups
 *
 * No reference-repo file to port from. Both requests verified as read
 * operations (`ReadRequest` union in `node_modules/komodo_client/dist/
 * types.d.ts`, not `WriteRequest`) despite "export" sounding like a write.
 *
 * @module tools/toml
 */

import type { Types } from "komodo_client";
import { defineTool } from "../mcp/define-tool.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { ToolCategories, ToolScopes } from "../config/index.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { redactTomlSecrets } from "../utils/redact.js";
import { renderTomlExport } from "./renderers/toml.js";
import { tomlOutputSchema, tomlExportAllInputSchema, tomlExportResourcesInputSchema } from "./schemas/toml.js";

// ============================================================================
// Export all
// ============================================================================

export const exportAllResourcesToTomlTool = defineTool({
  name: "komodo_toml_export_all",
  description:
    "Export every resource the caller has permission to view as sync TOML — the same format komodo_resource_sync_* reads from a git repo.",
  input: tomlExportAllInputSchema,
  output: tomlOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.TOML },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("exportAllResourcesToToml", () =>
      komodo.client.read("ExportAllResourcesToToml", {
        include_resources: args.include_resources ?? true,
        ...(args.tags !== undefined && { tags: args.tags }),
        ...(args.include_variables !== undefined && { include_variables: args.include_variables }),
        ...(args.include_user_groups !== undefined && { include_user_groups: args.include_user_groups }),
      }),
    );
    const payload = { toml: redactTomlSecrets(result.toml) };
    return structuredResult(payload, { text: renderTomlExport(payload) });
  },
});

registerToolDefinition(exportAllResourcesToTomlTool);

// ============================================================================
// Export specific resources
// ============================================================================

export const exportResourcesToTomlTool = defineTool({
  name: "komodo_toml_export_resources",
  description: "Export a specific set of resources and/or user groups as sync TOML.",
  input: tomlExportResourcesInputSchema,
  output: tomlOutputSchema,
  annotations: { readOnlyHint: true },
  _meta: { category: ToolCategories.TOML },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("exportResourcesToToml", () =>
      komodo.client.read("ExportResourcesToToml", {
        ...(args.targets !== undefined && { targets: args.targets as Types.ResourceTarget[] }),
        ...(args.user_groups !== undefined && { user_groups: args.user_groups }),
        ...(args.include_variables !== undefined && { include_variables: args.include_variables }),
      }),
    );
    const payload = { toml: redactTomlSecrets(result.toml) };
    return structuredResult(payload, { text: renderTomlExport(payload) });
  },
});

registerToolDefinition(exportResourcesToTomlTool);
