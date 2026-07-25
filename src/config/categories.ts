/**
 * Tool Categories
 *
 * Opaque category strings attached to every tool via `_meta.category`,
 * wired through `registerTool()` in `src/server/create-server.ts`.
 * Not enforced or interpreted anywhere in this codebase — carried
 * for client-side filtering/grouping only.
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/config/categories.ts).
 *
 * @module config/categories
 */

export const ToolCategories = {
  CONFIG: "config",
  SERVER: "server",
  SWARM: "swarm",
  CONTAINER: "container",
  TERMINAL: "terminal",
  STACK: "stack",
  DEPLOYMENT: "deployment",
  BUILD: "build",
  REPO: "repo",
  PROCEDURE: "procedure",
  ACTION: "action",
  ALERTER: "alerter",
  USER: "user",
  VARIABLE: "variable",
  RESOURCE_SYNC: "resource_sync",
  UPDATE: "update",
  DOCKER: "docker",
  TAG: "tag",
  ONBOARDING_KEY: "onboarding_key",
  BUILDER: "builder",
  PROVIDER: "provider",
  USER_GROUP: "user_group",
  PERMISSION: "permission",
  TOML: "toml",
} as const;

export type ToolCategory = (typeof ToolCategories)[keyof typeof ToolCategories];
