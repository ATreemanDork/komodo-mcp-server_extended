/**
 * Config Renderers
 *
 * Markdown renderers for `komodo_health_check` (`komodo_configure`'s
 * response text is built inline in the handler, matching the reference
 * repo — it is not routed through a shared renderer function there either).
 *
 * Ported near-verbatim from the reference repo
 * (references/komodo-mcp-server/src/utils/markdown.ts, `renderHealthCheck`).
 *
 * @module tools/renderers/config
 */

import { RESPONSE_ICONS } from "../../config/index.js";

interface HealthCheckPayload {
  readonly configured: boolean;
  readonly healthy: boolean;
  readonly server?: string;
  readonly komodo_version?: string;
  readonly mcp_server_version: string;
  readonly error?: string;
}

export function renderHealthCheck(payload: HealthCheckPayload): string {
  if (!payload.configured) {
    const lines = [
      `${RESPONSE_ICONS.WARNING} Komodo not configured.`,
      "",
      `MCP server: v${payload.mcp_server_version}`,
      "",
      "_Run `komodo_configure` to connect to a Komodo instance._",
    ];
    return lines.join("\n");
  }

  const icon = payload.healthy ? RESPONSE_ICONS.SUCCESS : RESPONSE_ICONS.ERROR;
  const verdict = payload.healthy ? "healthy" : "unhealthy";
  const server = payload.server ?? "(unknown)";
  const lines = [`${icon} Komodo ${verdict} — ${server}`, ""];
  if (payload.komodo_version) lines.push(`• Komodo version: v${payload.komodo_version}`);
  lines.push(`• MCP server version: v${payload.mcp_server_version}`);
  if (payload.error) lines.push(`• Error: ${payload.error}`);
  return lines.join("\n");
}
