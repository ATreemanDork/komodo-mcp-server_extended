# AGENTS.md — codebase guide for AI agents & contributors

Context for an agent (or human) picking this repo up cold — especially to extend
it to a new or changed Komodo API. Read this first; it explains the shape of the
code and the one pattern every tool follows.

## What this is

An MCP (Model Context Protocol) server exposing the [Komodo](https://github.com/moghtech/komodo)
container-orchestration API as **114 tools**. It is an extended fork of
`MP-Tool/komodo-mcp-server`; see [FORK_NOTES.md](FORK_NOTES.md) for the delta.

**Stack:** TypeScript, Node ≥ 20 (built/tested on 22), **ESM** (note: relative
imports use `.js` extensions even though sources are `.ts`). Key dependencies:
- `@modelcontextprotocol/sdk` — the official MCP SDK (this fork builds directly on
  it via a thin in-house seam, not a third-party framework).
- `komodo_client` — the official Komodo API client. Its types are typeshare-
  generated 1:1 from Komodo Core's Rust structs; this is your source of truth for
  request/response shapes.
- `zod` (schemas + validation), `express`/`cors`/`helmet`/`express-rate-limit`
  (HTTP transport), `pino` (logging), `vitest` (tests).

## Repository layout

```
src/
  index.ts                  Entry point: picks transport from MCP_TRANSPORT, boots.
  config/
    env.ts                  Zod-validated environment surface (KOMODO_*, MCP_*, ...).
    categories.ts           ToolCategories — the _meta.category values.
    scopes.ts               ToolScopes — requiredScopes values (carried, not yet enforced).
    descriptions.ts, tools.config.ts, duration.ts, version.ts
  mcp/
    define-tool.ts          defineTool(): the ONLY adaptation layer over the SDK.
    registry.ts             In-process registry of tool descriptors.
    resources.ts            Ephemeral resource-link store (session-scoped, TTL'd).
    content.ts              structuredResult()/errorResult()/resourceLinkContent().
  server/
    create-server.ts        Builds the McpServer; the ONLY place registerTool() is called.
    transports/
      http.ts               Streamable HTTP transport (POST/GET/DELETE /mcp) + /health, /ready.
      stdio.ts              stdio transport.
    logging.ts
  guardrails/
    policy.ts               Guardrail tiers + classifiers (which tools/actions are destructive).
    confirm.ts              HMAC dry-run/confirm-token issue + verify.
  tools/
    <domain>.ts             Tool definitions for a domain (defineTool + handler).
    schemas/<domain>.ts     Zod input/output schemas for that domain.
    renderers/<domain>.ts   Markdown renderers for that domain's responses.
    renderers/_shared.ts    Shared render primitives (stateBadge, truncate, pageFooter, ...).
    index.ts                Imports every domain file — the registration manifest.
  errors/                   AppError hierarchy + factory + sensitive-key redaction.
  utils/
    redact.ts               Secret redaction (masks secret-shaped values in output).
    pagination.ts, polling.ts, resource-link.ts, response-formatter.ts, api-helpers.ts
  client.ts                 Komodo client init from env (initializeKomodoClientFromEnv).
  polyfills/local-storage.ts  Node polyfill for a browser-only call in a komodo_client dep.
test/
  unit/                     Mocked, hermetic. Run by `npm test`. Never touches real infra.
  integration/              Real Komodo instance, disposable resources. `npm run test:integration`.
```

## Core architecture: how a tool reaches the SDK

Three layers, deliberately decoupled so handlers are unit-testable without a transport:

1. **`defineTool(config)`** (`src/mcp/define-tool.ts`) returns a plain descriptor.
   It never touches an `McpServer`. If the config has a `guardrail` field, this is
   where the input schema is extended with `dry_run`/`confirm` and the handler is
   wrapped in the dry-run/confirm dance — the tool's own handler never sees those
   two fields.
2. **`registry.ts`** collects descriptors (each domain file calls
   `registerToolDefinition()` at import time).
3. **`create-server.ts`** is the single place that calls
   `McpServer.registerTool()`, wiring input schema, output schema, `_meta`, and
   annotations. It also registers the ephemeral-resource template and starts the
   TTL sweep.

`src/tools/index.ts` imports every domain file; importing it runs all the
registrations. **To add a domain you must add its import there** — that's the manifest.

## Anatomy of a tool domain

Each Komodo domain is three files, one job each:

- `schemas/<domain>.ts` — Zod **input and output** schemas. Every tool declares
  both; the SDK validates `structuredContent` against the output schema on every
  non-error response.
- `<domain>.ts` — the `defineTool({...})` calls. The `handler` validates nothing
  itself (Zod already did); it calls `komodo_client` (via `src/client.ts`'s
  connection), maps the response, and returns a `CallToolResult` built with
  `structuredResult()` / `errorResult()` / a resource link.
- `renderers/<domain>.ts` — pure functions turning a mapped response into the
  markdown `text` block, using primitives from `renderers/_shared.ts`.

Cross-cutting metadata: `_meta: { category }` from `config/categories.ts`, and
`requiredScopes` from `config/scopes.ts` (carried on every tool but not yet
enforced — a deferred milestone).

## Adding or changing a tool

1. Add/adjust the Zod input+output schema in `schemas/<domain>.ts`.
2. Add/adjust the `defineTool({ name, description, input, output, _meta, handler,
   guardrail? })` in `<domain>.ts`. The handler calls the relevant `komodo_client`
   method and maps its result.
3. Add a renderer in `renderers/<domain>.ts` for the markdown output.
4. If it's a new domain file, add its import to `src/tools/index.ts`.
5. If destructive, set `guardrail: "destructive"` (or `"critical"`), or a
   classifier for `*_action` tools where only some `action` values are destructive
   (see `guardrails/policy.ts`).
6. Run the gates (below). Add/extend tests.

## Aligning to a new / changed Komodo API version

This is the most common reason to touch this repo. The workflow:

- **`komodo_client` is the contract.** It's pinned in `package.json` (currently
  `^2.1.1`). Its generated types mirror Komodo Core's Rust structs — when Core
  changes a request/response, bump `komodo_client` to a version whose types
  include the change, then update the affected schema + handler + renderer.
- **Check the pin vs the running Core.** Some request/response shapes only exist in
  newer `komodo_client` types. If a shape you need is missing, the pin is too old.
- **Watch the `null` vs `undefined` gotcha.** Komodo's API returns `null` for
  absent fields; Zod `.optional()` allows `undefined`, not `null`. Guard optional
  fields with a truthy check, not `!== undefined`, or the output schema will reject
  a real `null`. (Several tools were bitten by this — grep for the convention.)
- **Some resources need the Mongo ObjectId, not the name, for rename/delete**
  (Tag, UserGroup, ...). The affected tool files resolve name→id first (a
  `Get*`/list lookup) before the write. Follow that pattern for any new resource
  with the same behavior.
- **Name-validation regexes** may differ per resource (e.g. Variables:
  `^[a-zA-Z_][a-zA-Z0-9_]*$`). Mirror Core's constraint in the Zod schema so bad
  input fails client-side.
- Re-run the gates, then the integration suite against a disposable Komodo server
  (`npm run test:integration`) to confirm the real API still matches.

## Conventions & standards

- ESM with `.js` import extensions on relative imports.
- ESLint runs `strictTypeChecked`. A common friction: interpolating a
  number/boolean into a template literal is flagged — wrap with `String(...)`.
- Every tool declares an **output** Zod schema; the SDK enforces it. A non-error
  response MUST carry matching `structuredContent`. The guardrail dry-run/reject
  path uses `isError: true` precisely because that's the SDK's only exemption from
  output-schema validation.
- Large payloads (inspect output, logs, compose files) are offloaded to a
  session-scoped, TTL'd MCP `resource_link` (`utils/resource-link.ts` +
  `mcp/resources.ts`) rather than inlined. stdio callers (no session) always inline.
- Secret redaction: mask secret-shaped values in output via `utils/redact.ts`;
  never widen a mapper to spread a raw API response containing secrets.
- Errors go through the `AppError` factory (`src/errors/`), which redacts sensitive
  keys.

## Build, gates, and tests

```bash
npm install
npm run typecheck && npm run build && npm run lint && npm test   # the four gates
```

- `npm run build` → `build/index.js` (the entry point; also what Docker runs).
- `npm test` runs **unit tests only** (`test/unit/**`) — hermetic, safe, no infra.
- `npm run test:integration` runs the integration suite against a **real** Komodo
  instance and creates/destroys disposable resources. It loads `.env` and needs
  `KOMODO_URL` + credentials + `KOMODO_TEST_SERVER_ID`. See
  [test/integration/README.md](test/integration/README.md).

## Safety rules (do not violate)

- **Never** dump environment variables (`env`, `printenv`, `env | grep`) or read
  `.env` in shell — credentials live there. Live checks run the built server with
  `node --env-file=.env build/index.js`; the app injects env, you never print it.
- **Never** commit `.env` (it's gitignored) or log a secret value.
- Integration tests hit real infrastructure — only ever point them at a disposable
  server you control.
