/**
 * Tag Schemas
 *
 * Zod schemas for Komodo Tag resources (`komodo_tag_*` tools).
 *
 * No reference-repo file to port from — `references/komodo-mcp-server`
 * never built this category (a real gap this project closes, not a
 * mechanical port). Modeled on `schemas/alerter.ts`'s flat create/update
 * apply-input shape, the closest existing analog (small Komodo resource,
 * generic list/info/apply/delete CRUD). Field names verified against
 * `node_modules/komodo_client/dist/types.d.ts` (`Tag`, `TagColor`,
 * `CreateTag`, `RenameTag`, `UpdateTagColor`, `DeleteTag`).
 *
 * @module tools/schemas/tag
 */

import { z } from "zod";
import { Types } from "komodo_client";
import { resourceNameSchema } from "./validators.js";
import { pageOutputSchema } from "./shared.js";

/** Tag identifier (id or name) accepted by the Komodo API. */
export const tagIdSchema = z.string().min(1);

/** Tag color — mirrors `Types.TagColor` (a large string enum), not hand-enumerated. */
export const tagColorSchema = z.nativeEnum(Types.TagColor);

/** Compact summary of a single tag. Tags are tiny — this doubles as the full resource. */
export const tagSummarySchema = z.object({
  id: z.string().describe("Tag ID"),
  name: z.string().describe("Tag name"),
  owner: z.string().optional().describe("User ID that owns this tag, if set"),
  color: tagColorSchema.optional().describe("Display color"),
});

/** Output of `komodo_tag_list`. */
export const tagListOutputSchema = z
  .object({
    items: z.array(tagSummarySchema).describe("Tags registered in Komodo"),
    page: pageOutputSchema.optional(),
  })
  .describe("List of registered tags");

/** Output of `komodo_tag_info`. */
export const tagInfoOutputSchema = z
  .object({
    tag: tagSummarySchema,
  })
  .describe("Full tag resource");

// ============================================================================
// Input Schema — CRUD
// ============================================================================

/**
 * Input for `komodo_tag_apply` (create-or-update).
 *
 * Flat schema so MCP Inspector renders the form. The handler enforces
 * `name` for create and `tag` for update at runtime.
 *
 * Unlike Alerter/Variable, there is no single generic "UpdateTag" API call:
 * renaming (`RenameTag`) and recoloring (`UpdateTagColor`) are separate write
 * calls. On update, the handler dispatches to one or both, sequentially,
 * based on which of `name`/`color` is provided.
 */
export const tagApplyInputSchema = z.object({
  action: z
    .enum(["create", "update"])
    .describe("'create' to register a new tag, 'update' to rename/recolor an existing one"),
  name: resourceNameSchema
    .optional()
    .describe(
      "Required when action='create' — unique name for the new tag. When action='update' and provided, renames the tag to this name.",
    ),
  tag: tagIdSchema.optional().describe("Required when action='update' — existing tag id or name"),
  color: tagColorSchema
    .optional()
    .describe(
      "When action='create', initial color (default: Slate). When action='update' and provided, recolors the tag.",
    ),
});
