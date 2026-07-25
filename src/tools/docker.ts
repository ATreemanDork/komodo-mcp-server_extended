/**
 * Docker Introspection Tools
 *
 * Raw Docker image/network/volume introspection on a Komodo-managed server —
 * the read-only counterpart to `komodo_container_*`, closing the gap
 * `references/komodo-mcp-server` never covered (containers only).
 *
 * Tools (7):
 * - `komodo_docker_image_list`      — list cached images on a server
 * - `komodo_docker_image_inspect`   — Docker inspect data for an image
 * - `komodo_docker_image_history`   — layer history for an image
 * - `komodo_docker_network_list`    — list networks on a server
 * - `komodo_docker_network_inspect` — Docker inspect data for a network
 * - `komodo_docker_volume_list`     — list volumes on a server
 * - `komodo_docker_volume_inspect`  — Docker inspect data for a volume
 *
 * No reference-repo file to port from (a real gap this project closes, not
 * a mechanical port) — modeled directly on `tools/container.ts`'s
 * summary/inspect + resource-link pattern, the closest existing analog.
 *
 * @module tools/docker
 */

import { z } from "zod";
import type { Types } from "komodo_client";
import { defineTool } from "../mcp/define-tool.js";
import { structuredResult } from "../mcp/content.js";
import { registerToolDefinition } from "../mcp/registry.js";
import { PARAM_DESCRIPTIONS, ToolCategories, ToolScopes, config } from "../config/index.js";
import { requireClient, wrapApiCall } from "../utils/api-helpers.js";
import { paginate } from "../utils/pagination.js";
import { tryRegisterResource } from "../utils/resource-link.js";
import { redactObject, scrubText } from "../utils/redact.js";
import {
  renderImageList,
  renderImageInspect,
  renderImageHistory,
  renderNetworkList,
  renderNetworkInspect,
  renderVolumeList,
  renderVolumeInspect,
} from "./renderers/docker.js";
import { serverIdSchema } from "./schemas/validators.js";
import {
  imageListOutputSchema,
  imageInspectOutputSchema,
  imageHistoryOutputSchema,
  networkListOutputSchema,
  networkInspectOutputSchema,
  volumeListOutputSchema,
  volumeInspectOutputSchema,
} from "./schemas/docker.js";
import { inlineFullInputSchema, paginationInputSchema } from "./schemas/shared.js";

type ImageListItem = Types.ImageListItem;
type NetworkListItem = Types.NetworkListItem;
type VolumeListItem = Types.VolumeListItem;
type ImageHistoryResponseItem = Types.ImageHistoryResponseItem;

// ============================================================================
// Images
// ============================================================================

export const listDockerImagesTool = defineTool({
  name: "komodo_docker_image_list",
  description: "List Docker images cached locally on a server, with size and in-use status.",
  input: z
    .object({ server: serverIdSchema.describe(PARAM_DESCRIPTIONS.SERVER_ID_REQUIRED) })
    .merge(paginationInputSchema),
  output: imageListOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.DOCKER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const images = await wrapApiCall("listDockerImages", () =>
      komodo.client.read("ListDockerImages", { server: args.server }),
    );
    const allItems = images.map((i: ImageListItem) => ({
      id: i.id,
      name: i.name,
      ...(i.tags ? { tags: i.tags } : {}),
      size: i.size,
      in_use: i.in_use,
    }));
    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderImageList(payload) });
  },
});

registerToolDefinition(listDockerImagesTool);

export const inspectDockerImageTool = defineTool({
  name: "komodo_docker_image_inspect",
  description: "Get detailed Docker inspect data for an image (config, layers, exposed ports, env, labels).",
  input: z
    .object({
      server: serverIdSchema.describe(PARAM_DESCRIPTIONS.SERVER_ID_REQUIRED),
      image: z.string().min(1).describe("Image name or ID to inspect"),
    })
    .merge(inlineFullInputSchema),
  output: imageInspectOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.DOCKER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args, { sessionId }) => {
    const komodo = requireClient();
    const result = redactObject(
      await wrapApiCall("inspectDockerImage", () =>
        komodo.client.read("InspectDockerImage", { server: args.server, image: args.image }),
      ),
    );
    const link = tryRegisterResource({
      ctx: { sessionId },
      category: "inspect",
      name: `${args.image} (inspect)`,
      mimeType: "application/json",
      content: JSON.stringify(result, null, 2),
      ttlMs: config.KOMODO_RESOURCE_TTL_INFO,
      inlineFull: args.inline_full,
      description: `Docker inspect data for image ${args.image} on ${args.server}`,
    });
    const payload = link
      ? { summary: { name: args.image }, resourceLink: link }
      : { summary: { name: args.image }, inspect: result };
    return structuredResult(payload, { text: renderImageInspect(payload), ...(link ? { links: [link] } : {}) });
  },
});

registerToolDefinition(inspectDockerImageTool);

export const getDockerImageHistoryTool = defineTool({
  name: "komodo_docker_image_history",
  description: "Get the layer history of a Docker image (each build step, its size, and the command that produced it).",
  input: z
    .object({
      server: serverIdSchema.describe(PARAM_DESCRIPTIONS.SERVER_ID_REQUIRED),
      image: z.string().min(1).describe("Image name or ID"),
    })
    .merge(inlineFullInputSchema),
  output: imageHistoryOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.DOCKER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args, { sessionId }) => {
    const komodo = requireClient();
    const result = await wrapApiCall("listDockerImageHistory", () =>
      komodo.client.read("ListDockerImageHistory", { server: args.server, image: args.image }),
    );
    const items = result.map((l: ImageHistoryResponseItem) => ({
      id: l.Id,
      created: l.Created,
      // Layer commands can embed build-arg secrets or credentialed URLs
      // (`RUN pip install https://user:pass@…`, `--build-arg TOKEN=…`) — scrub
      // before echoing, same rationale as the volume Options scrub below.
      created_by: scrubText(l.CreatedBy),
      size: l.Size,
      ...(l.Tags ? { tags: l.Tags } : {}),
    }));
    const link = tryRegisterResource({
      ctx: { sessionId },
      category: "inspect",
      name: `${args.image} (history)`,
      mimeType: "application/json",
      content: JSON.stringify(items, null, 2),
      ttlMs: config.KOMODO_RESOURCE_TTL_INFO,
      inlineFull: args.inline_full,
      description: `Layer history for image ${args.image} on ${args.server}`,
    });
    const payload = link
      ? { summary: { name: args.image }, items: [], resourceLink: link }
      : { summary: { name: args.image }, items };
    return structuredResult(payload, { text: renderImageHistory(payload), ...(link ? { links: [link] } : {}) });
  },
});

registerToolDefinition(getDockerImageHistoryTool);

// ============================================================================
// Networks
// ============================================================================

export const listDockerNetworksTool = defineTool({
  name: "komodo_docker_network_list",
  description: "List Docker networks on a server, with driver and scope.",
  input: z
    .object({ server: serverIdSchema.describe(PARAM_DESCRIPTIONS.SERVER_ID_REQUIRED) })
    .merge(paginationInputSchema),
  output: networkListOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.DOCKER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const networks = await wrapApiCall("listDockerNetworks", () =>
      komodo.client.read("ListDockerNetworks", { server: args.server }),
    );
    const allItems = networks.map((n: NetworkListItem) => ({
      ...(n.name ? { name: n.name } : {}),
      ...(n.id ? { id: n.id } : {}),
      ...(n.driver ? { driver: n.driver } : {}),
      ...(n.scope ? { scope: n.scope } : {}),
    }));
    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderNetworkList(payload) });
  },
});

registerToolDefinition(listDockerNetworksTool);

export const inspectDockerNetworkTool = defineTool({
  name: "komodo_docker_network_inspect",
  description: "Get detailed Docker inspect data for a network (subnets, connected containers, IPAM config).",
  input: z
    .object({
      server: serverIdSchema.describe(PARAM_DESCRIPTIONS.SERVER_ID_REQUIRED),
      network: z.string().min(1).describe("Network name or ID to inspect"),
    })
    .merge(inlineFullInputSchema),
  output: networkInspectOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.DOCKER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args, { sessionId }) => {
    const komodo = requireClient();
    const result = redactObject(
      await wrapApiCall("inspectDockerNetwork", () =>
        komodo.client.read("InspectDockerNetwork", { server: args.server, network: args.network }),
      ),
    );
    const link = tryRegisterResource({
      ctx: { sessionId },
      category: "inspect",
      name: `${args.network} (inspect)`,
      mimeType: "application/json",
      content: JSON.stringify(result, null, 2),
      ttlMs: config.KOMODO_RESOURCE_TTL_INFO,
      inlineFull: args.inline_full,
      description: `Docker inspect data for network ${args.network} on ${args.server}`,
    });
    const payload = link
      ? { summary: { name: args.network }, resourceLink: link }
      : { summary: { name: args.network }, inspect: result };
    return structuredResult(payload, { text: renderNetworkInspect(payload), ...(link ? { links: [link] } : {}) });
  },
});

registerToolDefinition(inspectDockerNetworkTool);

// ============================================================================
// Volumes
// ============================================================================

export const listDockerVolumesTool = defineTool({
  name: "komodo_docker_volume_list",
  description: "List Docker volumes on a server, with driver, mountpoint, and in-use status.",
  input: z
    .object({ server: serverIdSchema.describe(PARAM_DESCRIPTIONS.SERVER_ID_REQUIRED) })
    .merge(paginationInputSchema),
  output: volumeListOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.DOCKER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args) => {
    const komodo = requireClient();
    const volumes = await wrapApiCall("listDockerVolumes", () =>
      komodo.client.read("ListDockerVolumes", { server: args.server }),
    );
    const allItems = volumes.map((v: VolumeListItem) => ({
      name: v.name,
      ...(v.driver ? { driver: v.driver } : {}),
      ...(v.mountpoint ? { mountpoint: v.mountpoint } : {}),
      in_use: v.in_use,
    }));
    const { items, page } = paginate(allItems, args.cursor, args.page_size);
    const payload = { items: [...items], page };
    return structuredResult(payload, { text: renderVolumeList(payload) });
  },
});

registerToolDefinition(listDockerVolumesTool);

export const inspectDockerVolumeTool = defineTool({
  name: "komodo_docker_volume_inspect",
  description: "Get detailed Docker inspect data for a volume (labels, driver options, scope).",
  input: z
    .object({
      server: serverIdSchema.describe(PARAM_DESCRIPTIONS.SERVER_ID_REQUIRED),
      volume: z.string().min(1).describe("Volume name to inspect"),
    })
    .merge(inlineFullInputSchema),
  output: volumeInspectOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  _meta: { category: ToolCategories.DOCKER },
  requiredScopes: [ToolScopes.READ],
  handler: async (args, { sessionId }) => {
    const komodo = requireClient();
    const result = redactObject(
      await wrapApiCall("inspectDockerVolume", () =>
        komodo.client.read("InspectDockerVolume", { server: args.server, volume: args.volume }),
      ),
    );
    // Volume driver Options can carry `password=` inside comma-separated mount-
    // option strings (e.g. CIFS/NFS `o=` values) that redactObject's key-name
    // matching doesn't catch — pattern-scrub each option value.
    if (result.Options && typeof result.Options === "object") {
      const opts = result.Options as Record<string, unknown>;
      for (const [k, v] of Object.entries(opts)) {
        if (typeof v === "string") opts[k] = scrubText(v);
      }
    }
    const link = tryRegisterResource({
      ctx: { sessionId },
      category: "inspect",
      name: `${args.volume} (inspect)`,
      mimeType: "application/json",
      content: JSON.stringify(result, null, 2),
      ttlMs: config.KOMODO_RESOURCE_TTL_INFO,
      inlineFull: args.inline_full,
      description: `Docker inspect data for volume ${args.volume} on ${args.server}`,
    });
    const payload = link
      ? { summary: { name: args.volume }, resourceLink: link }
      : { summary: { name: args.volume }, inspect: result };
    return structuredResult(payload, { text: renderVolumeInspect(payload), ...(link ? { links: [link] } : {}) });
  },
});

registerToolDefinition(inspectDockerVolumeTool);
