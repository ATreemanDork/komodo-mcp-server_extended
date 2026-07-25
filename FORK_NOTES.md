# What this fork adds vs upstream

This is an extended fork of [`MP-Tool/komodo-mcp-server`](https://github.com/MP-Tool/komodo-mcp-server)
(Marcel Pfennig, GPL-3.0). It began as a straight port of that server and then
grew new capability. This document is the summary a maintainer of the upstream
project can diff against to adopt whatever is useful.

## 1. Eight new tool categories (70 → 114 tools)

Upstream exposed 70 tools; this fork exposes 114. The additions:

| Category | Tools | Notes |
|---|---|---|
| Docker introspection | 7 | image/network/volume `list` + `inspect`, image `history` — raw per-server Docker data |
| Tag | 4–5 | Get/List/Create/Rename/Delete (name↔ObjectId resolution handled) |
| Provider | ~12 | GitProviderAccount **and** DockerRegistryAccount (symmetric CRUD + `*FromConfig` reads) |
| Builder | 6 | Get/List/Create/Copy/Update/Rename/Delete — closes the "must attach builder to RunBuild" gap |
| OnboardingKey | 4 | List/Create/Update/Delete (incl. the `privileged` flag) |
| UserGroup | 8 | CRUD + AddUser/RemoveUser/SetUsers/SetEveryone |
| Permission | 6 | the RBAC matrix: Get/List/ListUserTargetPermissions + 3 Update ops |
| Toml | 2 | export resources / export all (secrets render as `[[VAR]]` placeholders, never raw) |

## 2. Guardrail layer for destructive operations

Destructive and critical tools require a two-step **dry-run → confirm-token**
handshake before they execute (HMAC-signed token, auto-generated key by default).
A model cannot delete, destroy, or overwrite in a single unreviewed call. Safe
operations and the `*_action` tools' non-destructive sub-actions pass straight
through. Implemented centrally (`src/guardrails/`) and attached declaratively via
a `guardrail` field on each tool definition, so the policy is consistent across
all 27 gated call sites rather than reimplemented per tool.

## 3. Tool-output secret redaction (closes the #160 class)

Upstream issue [#160](https://github.com/MP-Tool/komodo-mcp-server/issues/160)
("secrets can leak through tool output") describes the real live threat channel:
tool responses flowing through a gateway to the model/model-provider. This fork
closes that class centrally — variable values, resolved container runtime env,
provider tokens, alerter endpoints/webhook secrets, and tokenised clone URLs are
masked in tool output; objects are rebuilt with `has_token`-style projections
rather than spreading raw API responses.

> A detailed, tool-by-tool exploitation map exists but is **not** published here
> to avoid broadcasting exploit detail against still-deployed upstream instances.
> It is available privately to the upstream maintainer on request.

## 4. Architecture: own MCP/SDK seam

The single biggest divergence, and the reason this is a fork rather than a PR:
upstream builds on an intermediate `mcp-server-framework`. This fork builds
directly on the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk),
with its own thin seam (`src/mcp/`) over it. Every tool declares a Zod **input
and output** schema, validated on each call; large payloads (inspect output,
logs, compose files) are offloaded to session-scoped, TTL'd MCP `resource_link`s
rather than inlined.

## 5. Testing

- Unit tests for the shared pure-logic utilities (pagination, duration,
  response formatting, guardrail policy, resource registry).
- A real **integration suite** (`test/integration/`) that drives the full tool
  surface against a live Komodo instance with disposable resources — full CRUD
  lifecycles for the new categories, plus live proof of the guardrail split
  (safe actions run friction-free; destructive actions require dry-run/confirm).

## Provenance

Everything in categories the upstream already had (servers, stacks, deployments,
builds, repos, containers, actions, procedures, updates, alerters, variables,
resource-syncs, users, swarm, config) was ported from upstream and carries its
design forward. The eight categories above and sections 2–4 are new work.
