/**
 * Docker Introspection Schemas
 *
 * Zod schemas for raw Docker image/network/volume introspection
 * (`komodo_docker_*` tools) on a Komodo-managed server.
 *
 * Unlike every other domain in this codebase, there is no reference-repo
 * file to port from — `references/komodo-mcp-server` never built this
 * category (one of the real gaps this project exists to close). Modeled
 * directly on `schemas/container.ts`'s summary/inspect split, since
 * containers are the closest existing analog (also raw per-server Docker
 * data, not a first-class Komodo resource).
 *
 * @module tools/schemas/docker
 */

import { z } from "zod";
import { resourceLinkSchema, pageOutputSchema } from "./shared.js";

// ============================================================================
// Images
// ============================================================================

export const imageSummarySchema = z.object({
  id: z.string().describe("Content-addressable image ID"),
  name: z.string().describe("First repo tag, or the image ID if untagged"),
  tags: z.array(z.string()).optional().describe("All repo tags"),
  size: z.number().int().optional().describe("Total image size in bytes"),
  in_use: z.boolean().optional().describe("Whether any container currently uses this image"),
});

export const imageListOutputSchema = z
  .object({
    items: z.array(imageSummarySchema).describe("Docker images cached on the target server"),
    page: pageOutputSchema.optional(),
  })
  .describe("List of Docker images on a server");

export const imageInspectOutputSchema = z
  .object({
    summary: z.object({ name: z.string() }),
    inspect: z.unknown().optional().describe("Raw Docker image inspect payload, when returned inline"),
    resourceLink: resourceLinkSchema.optional(),
  })
  .describe("Docker inspect data for an image");

export const imageHistoryEntrySchema = z.object({
  id: z.string().describe("Layer ID"),
  created: z.number().int().describe("Unix timestamp (seconds) the layer was created"),
  created_by: z.string().describe("Command that produced this layer (pattern-scrubbed for embedded secrets)"),
  size: z.number().int().describe("Layer size in bytes"),
  tags: z.array(z.string()).optional().describe("Tags associated with this layer, if any"),
});

export const imageHistoryOutputSchema = z
  .object({
    summary: z.object({ name: z.string() }),
    items: z.array(imageHistoryEntrySchema).describe("Image layer history, most recent first"),
    resourceLink: resourceLinkSchema.optional(),
  })
  .describe("Layer history for a Docker image");

// ============================================================================
// Networks
// ============================================================================

export const networkSummarySchema = z.object({
  name: z.string().optional().describe("Network name"),
  id: z.string().optional().describe("Network ID"),
  driver: z.string().optional().describe("Network driver (bridge, overlay, host, ...)"),
  scope: z.string().optional().describe("Network scope (local, swarm, ...)"),
});

export const networkListOutputSchema = z
  .object({
    items: z.array(networkSummarySchema).describe("Docker networks on the target server"),
    page: pageOutputSchema.optional(),
  })
  .describe("List of Docker networks on a server");

export const networkInspectOutputSchema = z
  .object({
    summary: z.object({ name: z.string() }),
    inspect: z.unknown().optional().describe("Raw Docker network inspect payload, when returned inline"),
    resourceLink: resourceLinkSchema.optional(),
  })
  .describe("Docker inspect data for a network");

// ============================================================================
// Volumes
// ============================================================================

export const volumeSummarySchema = z.object({
  name: z.string().describe("Volume name"),
  driver: z.string().optional().describe("Volume driver"),
  mountpoint: z.string().optional().describe("Host mountpoint path"),
  in_use: z.boolean().optional().describe("Whether any container currently uses this volume"),
});

export const volumeListOutputSchema = z
  .object({
    items: z.array(volumeSummarySchema).describe("Docker volumes on the target server"),
    page: pageOutputSchema.optional(),
  })
  .describe("List of Docker volumes on a server");

export const volumeInspectOutputSchema = z
  .object({
    summary: z.object({ name: z.string() }),
    inspect: z.unknown().optional().describe("Raw Docker volume inspect payload, when returned inline"),
    resourceLink: resourceLinkSchema.optional(),
  })
  .describe("Docker inspect data for a volume");
