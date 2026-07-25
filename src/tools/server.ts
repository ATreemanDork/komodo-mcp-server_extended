/**
 * Server Tools
 *
 * Tools for listing, inspecting, applying (create-or-update), and deleting Komodo servers,
 * plus host-level operations (`komodo_server_action`) for batch container lifecycle,
 * Docker pruning, and resource deletion.
 *
 * Extends the initial proof-of-concept file (`komodo_server_list` only,
 * proving the `src/mcp/` seam end-to-end) to full parity with the
 * reference repo's tool surface
 * (references/komodo-mcp-server/src/tools/server.ts) — adds
 * `komodo_server_stats`/`_info`/`_apply`/`_delete`/`_action`.
 *
 * @module tools/server
 */

import { z } from "zod";
import type { Types } from "komodo_client";
import { defineTool } from "../mcp/define-tool.js";
import { destructiveWhenActionIn } from "../guardrails/policy.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { PARAM_DESCRIPTIONS, ToolCategories, ToolScopes, config } from "../config/index.js";
import { AppErrorFactory } from "../errors/index.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { redactObject } from "../utils/redact.js";
import { paginate } from "../utils/pagination.js";
import { wrapExecuteAndPoll, buildActionResult, extractUpdateId } from "../utils/polling.js";
import { buildApplyResult, buildDeleteResult } from "../utils/response-formatter.js";
import { tryRegisterResource } from "../utils/resource-link.js";
import { renderServerList, renderServerInfo, renderServerStats } from "./renderers/server.js";
import { renderActionResult } from "./renderers/_shared.js";
import { serverIdSchema } from "./schemas/validators.js";
import {
  serverApplyInputSchema,
  serverActionInputSchema,
  serverActionOutputSchema,
  serverListOutputSchema,
  serverInfoOutputSchema,
  serverStatsOutputSchema,
} from "./schemas/server.js";
import {
  applyResultSchema,
  deleteResultSchema,
  inlineFullInputSchema,
  paginationInputSchema,
} from "./schemas/shared.js";

type ServerListItem = Types.ServerListItem;

// ============================================================================
// List
// ============================================================================

/** Compact summary of a server, mirroring the reference repo's list-tool shape. */
interface ServerSummary {
  id: string;
  name: string;
  state: string;
  version?: string;
  region?: string;
}

function toSummary(server: ServerListItem): ServerSummary {
  const version =
    server.info.version && server.info.version.toLowerCase() !== "unknown" ? server.info.version : undefined;
  return {
    id: server.id,
    name: server.name,
    state: server.info.state,
    ...(version ? { version } : {}),
    ...(server.info.region ? { region: server.info.region } : {}),
  };
}

export const listServersTool = defineTool({
  name: "komodo_server_list",
  description:
    "List all servers registered in Komodo. Shows server name, ID, status (healthy/unhealthy/disabled), Periphery version, and region.",
  input: paginationInputSchema,
  output: serverListOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.SERVER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const servers = await wrapApiCall("listServers", () => komodo.client.read("ListServers", {}));
    const allItems = servers.map(toSummary);
    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderServerList(payload) });
  },
});

registerToolDefinition(listServersTool);

// ============================================================================
// Stats
// ============================================================================

export const getServerStatsTool = defineTool({
  name: "komodo_server_stats",
  description:
    "Get server health status and state. Returns whether the Periphery agent is reachable and the server is healthy. For detailed system metrics, use komodo_server_info.",
  input: z.object({
    server: serverIdSchema.describe(PARAM_DESCRIPTIONS.SERVER_ID_FOR_STATS),
  }),
  output: serverStatsOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.SERVER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const stats = await wrapApiCall(`get stats for server '${args.server}'`, () =>
      komodo.client.read("GetServerState", { server: args.server }),
    );
    const payload = { server: args.server, status: stats.status };
    return structuredResult(payload, { text: renderServerStats(payload) });
  },
});

registerToolDefinition(getServerStatsTool);

// ============================================================================
// Info / CRUD
// ============================================================================

export const getServerInfoTool = defineTool({
  name: "komodo_server_info",
  description: "Get detailed information about a specific server",
  input: z
    .object({
      server: serverIdSchema.describe(PARAM_DESCRIPTIONS.SERVER_ID),
    })
    .merge(inlineFullInputSchema),
  output: serverInfoOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.SERVER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args, { sessionId }) => {
    const komodo = requireClient();
    const result = redactObject(
      await wrapApiCall("getServerInfo", () => komodo.client.read("GetServer", { server: args.server })),
    );
    const link = tryRegisterResource({
      ctx: { sessionId },
      category: "info",
      name: `${args.server} (server info)`,
      mimeType: "application/json",
      content: JSON.stringify(result, null, 2),
      ttlMs: config.KOMODO_RESOURCE_TTL_INFO,
      inlineFull: args.inline_full,
      description: `Full server resource for ${args.server}`,
    });
    const summary = { id: args.server, name: args.server };
    const payload = link ? { summary, resourceLink: link } : { summary, info: result };
    return structuredResult(payload, {
      text: renderServerInfo(payload),
      ...(link ? { links: [link] } : {}),
    });
  },
});

registerToolDefinition(getServerInfoTool);

export const applyServerTool = defineTool({
  name: "komodo_server_apply",
  description: [
    "Create or update a Komodo Server (PATCH-style; safe to call repeatedly).",
    'action="create": new server. Required: name. Periphery agent must be reachable at config.address.',
    'action="update": existing server (`server` required). Only fields in `config` change.',
  ].join("\n"),
  input: serverApplyInputSchema,
  output: applyResultSchema,
  annotations: { idempotentHint: false },
  _meta: { category: ToolCategories.SERVER },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    if (args.action === "create") {
      if (!args.name) throw AppErrorFactory.validation.fieldRequired("name");
      const name = args.name;
      const result = await wrapApiCall(
        "createServer",
        // @type-variance — Zod-inferred optional fields (`T | undefined`) → SDK `Partial<ServerConfig>` (`T`).
        () =>
          komodo.client.write("CreateServer", {
            name,
            config: (args.config ?? {}) as Types._PartialServerConfig,
          }),
      );
      const built = buildApplyResult("create", "server", name, result);
      return structuredResult(built.payload, { text: built.text });
    }
    if (!args.server) throw AppErrorFactory.validation.fieldRequired("server");
    const server = args.server;
    const result = await wrapApiCall(
      "updateServer",
      // @type-variance — Zod-inferred optional fields (`T | undefined`) → SDK `Partial<ServerConfig>` (`T`).
      () =>
        komodo.client.write("UpdateServer", {
          id: server,
          config: args.config as Types._PartialServerConfig,
        }),
    );
    const built = buildApplyResult("update", "server", server, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(applyServerTool);

export const deleteServerTool = defineTool({
  name: "komodo_server_delete",
  description: "Delete (unregister) a server",
  input: z.object({
    server: serverIdSchema.describe(PARAM_DESCRIPTIONS.SERVER_ID),
  }),
  output: deleteResultSchema,
  annotations: { destructiveHint: true },
  guardrail: "destructive",
  _meta: { category: ToolCategories.SERVER },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const result = await wrapApiCall("deleteServer", () => komodo.client.write("DeleteServer", { id: args.server }));
    const built = buildDeleteResult("server", args.server, result);
    return structuredResult(built.payload, { text: built.text });
  },
});

registerToolDefinition(deleteServerTool);

// ============================================================================
// Prune (host-level resource cleanup)
// ============================================================================

/**
 * Maps the `komodo_server_action` discriminator to the Komodo execute API name.
 * All targeted endpoints are host-scoped (single `{ server }` param), the
 * `delete_*` variants additionally require a `{ name }` param (validated at runtime).
 */
const SERVER_ACTION_API_MAP = {
  start_all_containers: "StartAllContainers",
  restart_all_containers: "RestartAllContainers",
  pause_all_containers: "PauseAllContainers",
  unpause_all_containers: "UnpauseAllContainers",
  stop_all_containers: "StopAllContainers",
  prune_containers: "PruneContainers",
  prune_images: "PruneImages",
  prune_volumes: "PruneVolumes",
  prune_networks: "PruneNetworks",
  prune_system: "PruneSystem",
  prune_docker_builders: "PruneDockerBuilders",
  prune_buildx: "PruneBuildx",
  delete_network: "DeleteNetwork",
  delete_image: "DeleteImage",
  delete_volume: "DeleteVolume",
} as const satisfies Record<z.infer<typeof serverActionInputSchema>["action"], string>;

export const serverActionTool = defineTool({
  name: "komodo_server_action",
  description:
    "Host-level operations on a Komodo server: batch container lifecycle (start/restart/pause/unpause/stop all), Docker resource pruning (containers, images, volumes, networks, system, builders, buildx), or deletion of named networks/images/volumes. Destructive — frees disk space or stops workloads.",
  input: serverActionInputSchema,
  output: serverActionOutputSchema,
  annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
  guardrail: destructiveWhenActionIn([
    "prune_containers",
    "prune_images",
    "prune_volumes",
    "prune_networks",
    "prune_system",
    "prune_docker_builders",
    "prune_buildx",
    "delete_network",
    "delete_image",
    "delete_volume",
  ]),
  _meta: { category: ToolCategories.SERVER },
  requiredScopes: [ToolScopes.ADMIN],
  handler: async (args) => {
    const komodo = requireClient();
    const apiAction = SERVER_ACTION_API_MAP[args.action];

    let params: Record<string, unknown>;
    if (args.action === "delete_network" || args.action === "delete_image" || args.action === "delete_volume") {
      if (!args.name) throw AppErrorFactory.validation.fieldRequired("name");
      params = { server: args.server, name: args.name };
    } else {
      params = { server: args.server };
    }

    const update = await wrapExecuteAndPoll(
      `${args.action} on server '${args.server}'`,
      // @sdk-constraint — SDK execute() type uses literal-keyed unions; runtime accepts mapped string
      () => komodo.client.execute(apiAction as "PruneContainers", params as unknown as Types.PruneContainers),
    );
    const payload = buildActionResult(update, args.action, "server", args.server, args.server);
    return structuredResult(payload, {
      text: renderActionResult(payload, { updateId: extractUpdateId(update), logs: update.logs }),
    });
  },
});

registerToolDefinition(serverActionTool);
