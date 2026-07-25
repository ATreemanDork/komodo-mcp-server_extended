/**
 * Builder Schemas
 *
 * Zod schemas for Komodo Builder resources (`komodo_builder_*` tools). A
 * Builder is the compute target Komodo uses to actually run a Docker build
 * (referenced by `builder_id` from Build resources).
 *
 * No reference-repo file to port from — genuinely new construction closing
 * a real gap (`references/komodo-mcp-server` never modeled Builder). Field
 * names are grounded directly in `komodo_client`'s `dist/types.d.ts`
 * (`BuilderConfig`, `UrlBuilderConfig`, `ServerBuilderConfig`,
 * `AwsBuilderConfig`, `PartialBuilderConfig`/`_PartialAwsBuilderConfig` et
 * al.), not guessed. Modeled structurally on `tools/schemas/alerter.ts`
 * (CRUD shape) and `tools/schemas/deployment.ts`'s `DeploymentImageSchema`
 * (discriminated union keyed on `type`, `params` per variant).
 *
 * @module tools/schemas/builder
 */

import { z } from "zod";
import { resourceNameSchema } from "./validators.js";
import { pageOutputSchema, resourceLinkSchema } from "./shared.js";

/** Builder identifier (id or name) accepted by the Komodo API. */
export const builderIdSchema = z.string().min(1);

/** Compact summary of a single builder (mirrors `Types.BuilderListItemInfo`). */
export const builderSummarySchema = z.object({
  id: z.string().describe("Builder ID"),
  name: z.string().describe("Builder name"),
  builder_type: z.string().optional().describe("Builder variant: 'Url', 'Server', or 'Aws'"),
  instance_type: z
    .string()
    .optional()
    .describe("If 'Server': the server id. If 'Aws': the EC2 instance type (e.g. c5.xlarge). If 'Url': absent."),
});

/** Output of `komodo_builder_list`. */
export const builderListOutputSchema = z
  .object({
    items: z.array(builderSummarySchema).describe("Builders registered in Komodo"),
    page: pageOutputSchema.optional(),
  })
  .describe("List of registered builders");

/** Output of `komodo_builder_info`. */
export const builderInfoOutputSchema = z
  .object({
    summary: builderSummarySchema,
    info: z.unknown().optional().describe("Full Builder resource (only when not offloaded as a resource link)"),
    resourceLink: resourceLinkSchema.optional(),
  })
  .describe("Builder summary + optional full resource");

// ============================================================================
// Config — discriminated union (`Types.BuilderConfig` / `Types.PartialBuilderConfig`)
// ============================================================================

/**
 * Config for a "Url" builder — a Periphery agent reachable at a direct
 * address. Mirrors `Types.UrlBuilderConfig` (fields optional here to match
 * `_PartialUrlBuilderConfig`'s PATCH semantics — Komodo validates the final
 * shape).
 */
export const urlBuilderConfigParamsSchema = z
  .object({
    address: z.string().optional().describe("The address of the Periphery agent"),
    periphery_public_key: z
      .string()
      .optional()
      .describe("Expected public key associated with the Periphery private key. Empty = skip validation."),
    insecure_tls: z.boolean().optional().describe("Whether to validate the Periphery TLS certificate"),
    passkey: z
      .string()
      .optional()
      .describe("Deprecated. Use public/private keys instead. Empty = use passkey from core config."),
  })
  .describe("Configuration for a Periphery-address Builder");

/**
 * Config for a "Server" builder — an existing connected Komodo server used
 * as the build host. Mirrors `Types.ServerBuilderConfig`. This is the
 * variant most immediately useful in this deployment.
 */
export const serverBuilderConfigParamsSchema = z
  .object({
    server_id: z.string().optional().describe("The server id (or name) to use as the builder"),
  })
  .describe("Configuration for a connected-server Builder");

/** A git provider account (`Types.ProviderAccount`). */
export const providerAccountSchema = z.object({
  username: z.string().describe("The account username"),
  token: z.string().optional().describe("The account access token"),
});

/** A git provider available on an AWS builder AMI (`Types.GitProvider`). */
export const gitProviderSchema = z.object({
  domain: z.string().describe('The git provider domain. Default: "github.com"'),
  https: z.boolean().describe("Whether to use https. Default: true"),
  accounts: z.array(providerAccountSchema).describe("The accounts on the git provider"),
});

/** A docker registry available on an AWS builder AMI (`Types.DockerRegistry`). */
export const dockerRegistrySchema = z.object({
  domain: z.string().describe('The docker provider domain. Default: "docker.io"'),
  accounts: z.array(providerAccountSchema).describe("The accounts on the registry"),
  organizations: z
    .array(z.string())
    .optional()
    .describe("Available organizations on the registry provider, to push under an org's repo"),
});

/**
 * Config for an "Aws" builder — EC2 instances spawned on demand.
 * Mirrors `Types.AwsBuilderConfig` in full (ported faithfully, not
 * stubbed, per project standing rule — see `Types._PartialAwsBuilderConfig`
 * for the PATCH semantics this schema follows: top-level fields optional,
 * nested array element shapes unchanged since `Partial<T>` is shallow).
 */
export const awsBuilderConfigParamsSchema = z
  .object({
    region: z.string().optional().describe("The AWS region to create the instance in"),
    instance_type: z.string().optional().describe("The instance type to create for the build"),
    volume_gb: z.number().optional().describe("The size of the builder volume in GB"),
    ami_id: z
      .string()
      .optional()
      .describe(
        "The EC2 AMI id to create. Should have the periphery client configured to start on startup, and the necessary github/dockerhub accounts configured.",
      ),
    subnet_id: z.string().optional().describe("The subnet id to create the instance in"),
    key_pair_name: z.string().optional().describe("The key pair name to attach to the instance"),
    assign_public_ip: z
      .boolean()
      .optional()
      .describe("Whether to assign the instance a public IP address (likely needed to reach the open internet)"),
    use_public_ip: z
      .boolean()
      .optional()
      .describe("Whether core should use the public IP to communicate with periphery on the builder"),
    security_group_ids: z
      .array(z.string())
      .optional()
      .describe("Security group ids to attach to the instance (must allow core inbound access to periphery port)"),
    user_data: z.string().optional().describe("User data to deploy the instance with"),
    port: z.number().optional().describe("The port periphery will be running on. Default: 8120"),
    use_https: z.boolean().optional().describe("Whether periphery is running behind https"),
    periphery_public_key: z
      .string()
      .optional()
      .describe("Expected public key associated with the Periphery private key. Empty = skip validation."),
    insecure_tls: z.boolean().optional().describe("Whether to validate the Periphery TLS certificate"),
    git_providers: z.array(gitProviderSchema).optional().describe("Which git providers are available on the AMI"),
    docker_registries: z
      .array(dockerRegistrySchema)
      .optional()
      .describe("Which docker registries are available on the AMI"),
    secrets: z.array(z.string()).optional().describe("Which secrets are available on the AMI"),
  })
  .describe("Configuration for an on-demand EC2 Builder");

/**
 * Builder configuration (discriminated by `type`). Mirrors
 * `Types.BuilderConfig` / `Types.PartialBuilderConfig` directly — unlike
 * `AlerterConfig` (a wrapper object with an optional `endpoint` union
 * field), `BuilderConfig` *is* the 3-way union itself, so this schema is
 * used directly as the `config` field on apply, matching
 * `DeploymentImageSchema`'s shape.
 */
export const builderConfigSchema = z
  .union([
    z.object({
      type: z.literal("Url").describe("Use a Periphery address as a Builder"),
      params: urlBuilderConfigParamsSchema,
    }),
    z.object({
      type: z.literal("Server").describe("Use a connected server as a Builder"),
      params: serverBuilderConfigParamsSchema,
    }),
    z.object({
      type: z.literal("Aws").describe("Use EC2 instances spawned on demand as a Builder"),
      params: awsBuilderConfigParamsSchema,
    }),
  ])
  .describe("Builder configuration — see Komodo `BuilderConfig` discriminated union");

// ============================================================================
// Input Schemas — CRUD
// ============================================================================

/**
 * Input for `komodo_builder_apply` (create-or-update).
 *
 * Flat schema so MCP Inspector renders the form. The handler enforces
 * `name` for create and `builder` for update at runtime.
 */
export const builderApplyInputSchema = z.object({
  action: z
    .enum(["create", "update"])
    .describe("'create' to register a new builder, 'update' to PATCH an existing one"),
  name: resourceNameSchema.optional().describe("Required when action='create' — unique name for the new builder"),
  builder: builderIdSchema.optional().describe("Required when action='update' — existing builder id or name"),
  config: builderConfigSchema
    .optional()
    .describe("Builder configuration — discriminated by `type` ('Url', 'Server', or 'Aws')"),
});

/** Input for `komodo_builder_copy`. */
export const builderCopyInputSchema = z.object({
  name: resourceNameSchema.describe("Name for the new builder"),
  id: builderIdSchema.describe("Id or name of the existing builder to copy the configuration from"),
});

/** Input for `komodo_builder_rename`. */
export const builderRenameInputSchema = z.object({
  builder: builderIdSchema.describe("Id or name of the builder to rename"),
  name: resourceNameSchema.describe("New name for the builder"),
});
