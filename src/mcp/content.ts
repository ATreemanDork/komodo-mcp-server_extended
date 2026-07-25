/**
 * MCP Content Helpers
 *
 * Small builders for `CallToolResult` content blocks. Kept separate from
 * define-tool.ts so tool handlers can build content without importing the
 * whole tool-registration surface.
 *
 * @module mcp/content
 */

import type { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";

/**
 * Build a plain-text `TextContent` block.
 */
export function text(value: string): TextContent {
  return { type: "text", text: value };
}

/**
 * Build a `TextContent` block from a JSON-serializable value (pretty-printed).
 */
export function jsonText(value: unknown): TextContent {
  return text(JSON.stringify(value, null, 2));
}

/**
 * Build a successful `CallToolResult` from one or more content blocks.
 */
export function toolResult(...content: TextContent[]): CallToolResult {
  return { content };
}

/**
 * Build a successful `CallToolResult` whose sole content block is the
 * pretty-printed JSON of `value`.
 */
export function jsonResult(value: unknown): CallToolResult {
  return toolResult(jsonText(value));
}

/**
 * Minimal shape a resource-link spec must satisfy to be rendered as a
 * `resource_link` content block. Declared locally (not imported from
 * `utils/resource-link.ts`) so this module stays free of any dependency on
 * `src/tools/` — `tryRegisterResource`'s return type is structurally
 * compatible with this already.
 */
export interface ResourceLinkLike {
  readonly uri: string;
  readonly name: string;
  readonly mimeType?: string | undefined;
  readonly description?: string | undefined;
}

/**
 * Build a `resource_link` content block from a resource-link spec.
 */
export function resourceLinkContent(spec: ResourceLinkLike): NonNullable<CallToolResult["content"]>[number] {
  return {
    type: "resource_link",
    uri: spec.uri,
    name: spec.name,
    ...(spec.mimeType !== undefined && { mimeType: spec.mimeType }),
    ...(spec.description !== undefined && { description: spec.description }),
  };
}

export interface StructuredResultOptions {
  readonly text?: string;
  readonly links?: readonly ResourceLinkLike[];
}

/**
 * Build a successful `CallToolResult` carrying both a human-readable text
 * block and machine-readable `structuredContent` — the return shape every
 * ported tool handler uses. Mirrors the reference repo's `structured()`
 * helper (`mcp-server-framework`), adapted to this repo's stricter typing
 * (`data` must be a `Record<string, unknown>`, matching `CallToolResult`'s
 * own `structuredContent` type) and to `resourceLinkContent` above instead
 * of the framework's own resource-link builder.
 */
export function structuredResult(data: Record<string, unknown>, options?: StructuredResultOptions): CallToolResult {
  const displayText = options?.text ?? JSON.stringify(data, null, 2);
  const linkBlocks = (options?.links ?? []).map(resourceLinkContent);
  return {
    content: [text(displayText), ...linkBlocks],
    structuredContent: data,
  };
}

/**
 * Build an error `CallToolResult` (`isError: true`) from a message.
 */
export function errorResult(message: string): CallToolResult {
  return { content: [text(message)], isError: true };
}
