# Komodo MCP Server (extended)

A comprehensive [Model Context Protocol](https://modelcontextprotocol.io) server
for the [Komodo](https://github.com/moghtech/komodo) container-orchestration API.

This is an **extended fork** of [`MP-Tool/komodo-mcp-server`](https://github.com/MP-Tool/komodo-mcp-server)
by Marcel Pfennig (GPL-3.0). It carries that project's ideas forward with eight
additional tool categories, a guardrail layer for destructive operations, and
tool-output secret redaction. See [FORK_NOTES.md](FORK_NOTES.md) for the full
delta and [Attribution](#attribution) below.

> **Not affiliated with or endorsed by the upstream project.** It's an honest
> parallel offering — the transport architecture diverged (see below), so it is
> a fork rather than a proposed merge.

## What it does

Exposes the Komodo Core API to an MCP client (Claude, or anything speaking MCP)
as **114 tools** across servers, stacks, deployments, builds, repos, containers,
raw Docker introspection, tags, providers, permissions, and more — enough to
drive a Komodo fleet conversationally.

## What this fork adds over upstream

- **8 new tool categories** (upstream had 70 tools; this fork has 114):
  Docker introspection (image/network/volume list+inspect), Tag, Provider
  (git-provider + docker-registry accounts), Builder, OnboardingKey, UserGroup,
  Permission (the RBAC matrix), and Toml export.
- **A guardrail layer.** Destructive and critical operations require a two-step
  dry-run → confirm-token handshake before they execute, so a model can't delete
  or overwrite in a single unreviewed call. Safe operations pass through untouched.
- **Tool-output secret redaction.** Closes the secret-leak-through-tool-output
  class of issue (the channel described in upstream
  [#160](https://github.com/MP-Tool/komodo-mcp-server/issues/160)): variable
  values, resolved container env, provider tokens, alerter webhook secrets and
  tokenised clone URLs are masked in tool responses.
- **Own MCP/SDK seam.** Built directly on the official
  [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
  rather than an intermediate framework — every tool declares a Zod input *and*
  output schema, validated on each call.
- **A real integration test suite** (in addition to unit tests) that exercises
  the full tool surface against a live Komodo instance with disposable resources.

## Transports

- **stdio** — for local MCP clients (Claude Desktop, editors).
- **Streamable HTTP** — `POST/GET/DELETE /mcp`, for gateway-fronted deployments
  (e.g. behind LiteLLM). `/health` and `/ready` endpoints for liveness/readiness.

Select with `MCP_TRANSPORT=stdio|http`.

## Quick start

### Docker (build-it-yourself)

No public image is published yet, so build from source:

```bash
git clone https://github.com/ATreemanDork/komodo-mcp-server_extended.git
cd komodo-mcp-server_extended
cp .env.example .env          # fill in KOMODO_URL / KOMODO_API_KEY / KOMODO_API_SECRET
docker compose -f docker/compose.yaml up -d --build
```

The container defaults to HTTP transport on port 8000; check readiness with
`curl localhost:8000/ready`.

### Local (stdio, for Claude Desktop / editors)

```bash
npm install
npm run build
KOMODO_URL=https://komodo.example.com \
KOMODO_API_KEY=... KOMODO_API_SECRET=... \
MCP_TRANSPORT=stdio node build/index.js
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "komodo": {
      "command": "node",
      "args": ["/absolute/path/to/komodo-mcp-server_extended/build/index.js"],
      "env": {
        "KOMODO_URL": "https://komodo.example.com",
        "KOMODO_API_KEY": "your-api-key",
        "KOMODO_API_SECRET": "your-api-secret",
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

## Configuration

Copy `.env.example` to `.env`. Runtime variables:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `KOMODO_URL` | yes | — | Komodo Core API URL |
| `KOMODO_API_KEY` | one method | — | key-based auth (recommended) |
| `KOMODO_API_SECRET` | one method | — | key-based auth (recommended) |
| `MCP_TRANSPORT` | no | `stdio` | `stdio` \| `http` |
| `MCP_BIND_HOST` | no | `127.0.0.1` | HTTP bind host (`0.0.0.0` in the container) |
| `MCP_PORT` | no | `8000` | HTTP port (`/mcp`) |
| `MCP_MAX_SESSIONS` | no | `100` | concurrent HTTP session cap |
| `MCP_SESSION_IDLE_MS` | no | `30m` | idle HTTP session eviction (duration or ms) |
| `GUARDRAIL_HMAC_SECRET` | no | random per boot | set to keep confirm tokens valid across restarts |

**Authentication** — provide exactly one method: `KOMODO_API_KEY` +
`KOMODO_API_SECRET` (recommended), `KOMODO_USERNAME` + `KOMODO_PASSWORD`, or a
pre-obtained `KOMODO_JWT_TOKEN`. Every credential variable also accepts a
`*_FILE` variant (e.g. `KOMODO_API_KEY_FILE=/run/secrets/...`) that reads the
value from a file path, for Docker secrets. See `.env.example` for the full
list plus optional tuning variables (`API_TIMEOUT_MS`, resource-link TTLs).

The `GITEA_*` and `KOMODO_TEST_SERVER_ID` variables in `.env.example` are used
**only** by the integration test suite — never at runtime.

## Operational notes & sharp edges

The extended tool surface is powerful but has edges worth knowing before you point
an agent at a production Komodo.

- **The HTTP transport has no authentication of its own.** `/mcp` is intended to
  sit behind a gateway (LiteLLM, etc.) or reverse proxy that handles auth. Do
  **not** expose it directly to an untrusted network — anyone who can reach the
  port can drive every tool. Bind to loopback (`MCP_BIND_HOST=127.0.0.1`) or a
  private network and put an authenticating proxy in front.
- **114 tools is a large surface.** Handing a model all of them at once can
  degrade tool selection and eat context. If you only need a subset, filter at
  the client/gateway to the categories you actually use.
- **Destructive tools require a two-step dry-run → confirm.** The first call to a
  guardrailed tool (deletes, `destroy`, permission changes, privileged onboarding
  keys) returns `isError: true` with a `confirm` token and **does not execute** —
  that is by design, not a failure. Call again with the same arguments plus
  `dry_run: false` and that token to actually run it. An agent that treats the
  first response as a hard error will never complete these operations.
- **`komodo_exec` needs Komodo Core/Periphery ≥ 2.3.0.** On older versions it
  returns scaffold output with a null exit code, due to an upstream Periphery bug
  ([moghtech/komodo#1289](https://github.com/moghtech/komodo/issues/1289), fixed
  in 2.3.0). Not a bug in this server.
- **Permission model quirks (Komodo, not this server):**
  `komodo_permission_update_on_resource_type` writes to the target's own `all`
  map, which is **not** visible through `komodo_permission_list` /
  `list_for_target`; and reverting a grant to `None` does **not** delete the
  underlying permission document — it stays, at level `None`.
- **`komodo_permission_update_user_base` requires Super Admin** when the target
  user is itself an admin — a plain admin credential gets a 500.
- **Variable names must match `^[a-zA-Z_][a-zA-Z0-9_]*$`** (Komodo Core
  constraint) — no hyphens. Enforced client-side so bad names fail fast.
- **`komodo_configure` reconfigures the live Komodo connection at runtime.** Handy
  for switching targets, but it changes global state for the session — use
  deliberately.
- **Secret redaction is on by default — with one deliberate exception.** Variable
  values, resolved container env, provider tokens, alerter webhook secrets and
  tokenised clone URLs are masked in tool output. **But a few tools exist
  precisely to hand back a freshly-created credential** — creating an API key
  (`komodo_user_create_api_key`) or a privileged onboarding key
  (`komodo_onboarding_key_apply`) returns the real secret value **unredacted**,
  because masking it would defeat the entire purpose of the call. These
  value-reveal tools are guardrail-gated (dry-run/confirm), but a successful call
  returns a live secret in its output.

  > ⚠️ **Do not enable the value-reveal tools for cloud-hosted agents.** When the
  > model runs in someone else's cloud, tool output crosses that trust boundary —
  > the secret is transmitted to a third-party model provider (the exact #160 leak
  > channel this fork otherwise closes). Enable `komodo_user_create_api_key` /
  > `komodo_onboarding_key_apply` **only** for local agent/model deployments where
  > tool output never leaves infrastructure you control. For cloud/hosted agents,
  > disable or filter them at the gateway.

## Development

```bash
npm install
npm run typecheck && npm run build && npm run lint && npm test   # unit tests
```

`npm test` runs the unit suite only. The integration suite talks to a **real**
Komodo instance and creates/destroys disposable resources — run it explicitly
against a throwaway server you control:

```bash
# set KOMODO_URL/KEY/SECRET + KOMODO_TEST_SERVER_ID in .env first
npm run test:integration
```

See [test/integration/README.md](test/integration/README.md) for the required env.

## Requirements

- Node.js 20+ (built and tested on 22)
- A reachable Komodo Core instance with an API key/secret

## Attribution

- **Original author:** Marcel Pfennig / MP-Tool —
  [`MP-Tool/komodo-mcp-server`](https://github.com/MP-Tool/komodo-mcp-server).
- **This fork / extensions:** ATreemanDork.

## License

GPL-3.0, preserved from upstream. See [LICENSE.txt](LICENSE.txt).

## Security

This fork closes the tool-output secret-leak class described in upstream
[#160](https://github.com/MP-Tool/komodo-mcp-server/issues/160). To report a
vulnerability, please open an issue (or contact the maintainer privately for
anything sensitive) rather than disclosing details publicly.
