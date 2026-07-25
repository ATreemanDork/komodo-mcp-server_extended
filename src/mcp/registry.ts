/**
 * Tool Registry
 *
 * An explicit in-process registry: tool files call `registerToolDefinition()`
 * with the descriptor returned by `defineTool()`. This is a plain function
 * call, not an import-side-effect into a hidden global — so tool handlers
 * stay unit-testable without booting a transport, and `create-server.ts`
 * can enumerate exactly what's registered before wiring up the real
 * `McpServer`.
 *
 * @module mcp/registry
 */

import type { ToolDefinition } from "./define-tool.js";

const registry = new Map<string, ToolDefinition>();

/**
 * Register a tool descriptor. Throws if a tool with the same name is
 * already registered — a duplicate name is a programming error, not a
 * runtime condition to swallow.
 */
export function registerToolDefinition(definition: ToolDefinition): void {
  if (registry.has(definition.name)) {
    throw new Error(`Tool "${definition.name}" is already registered`);
  }
  registry.set(definition.name, definition);
}

/** All currently registered tool descriptors, in registration order. */
export function getRegisteredTools(): ToolDefinition[] {
  return [...registry.values()];
}

/** Remove every registered tool. Test-only — resets registry state between test files. */
export function clearRegistry(): void {
  registry.clear();
}
