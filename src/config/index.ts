/**
 * Configuration Module
 *
 * Re-export surface for config consumers.
 *
 * @module config
 */

/** This server's identity name, reported in the MCP `initialize` handshake. */
export const SERVER_NAME = "komodo-mcp";
export { APP_VERSION as SERVER_VERSION } from "./version.js";

export { config, getKomodoCredentials, type KomodoCredentials, type AppEnvConfig } from "./env.js";
export { ToolCategories, type ToolCategory } from "./categories.js";
export { ToolScopes, type ToolScope } from "./scopes.js";
export { VALIDATION_LIMITS, CONTAINER_LOGS_DEFAULTS, LOG_SEARCH_DEFAULTS } from "./tools.config.js";
export {
  RESPONSE_ICONS,
  PARAM_DESCRIPTIONS,
  CONFIG_DESCRIPTIONS,
  LOG_DESCRIPTIONS,
  FIELD_DESCRIPTIONS,
  RESTART_MODE_DESCRIPTIONS,
  ALERT_DESCRIPTIONS,
  THRESHOLD_DESCRIPTIONS,
} from "./descriptions.js";
