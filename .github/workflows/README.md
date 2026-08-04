# GitHub Workflows

CI, security scanning, and container-image release for this repository.

## Workflows

### `release.yml` — Release & publish Docker image

**Trigger:** push to `main` that changes `package.json` (a version bump), `src/**`,
`Dockerfile`, or the tsconfigs — or a manual `workflow_dispatch`.

**What it does:**
- Builds a multi-arch image (`amd64`, `arm64`, `arm/v7`, `arm/v6`).
- Publishes it to GitHub Container Registry: `ghcr.io/atreemandork/komodo-mcp-server_extended`.
- Generates SLSA provenance + SBOM attestations.
- Creates a GitHub Release with generated notes and tags (`x.y.z`, `x.y`, `x`, `latest`).

Only pushes an image when the `package.json` version actually changed (or on a
manual dispatch). No external secrets — uses the built-in `GITHUB_TOKEN`.

**Image tags:**
```
ghcr.io/atreemandork/komodo-mcp-server_extended:2.0.0
ghcr.io/atreemandork/komodo-mcp-server_extended:2.0
ghcr.io/atreemandork/komodo-mcp-server_extended:2
ghcr.io/atreemandork/komodo-mcp-server_extended:latest
```

### `pr-check.yml` — PR validation

Runs on PRs to `main`: TypeScript compile, `npm ci` + build, a Docker build test
when the Dockerfile changes, and dependency review.

### Security scanning

- `codeql.yml` — CodeQL static analysis.
- `osv-scanner.yml` — OSV dependency vulnerability scan.
- `scorecard.yml` — OpenSSF Scorecard supply-chain checks.

All use `GITHUB_TOKEN`; no extra configuration required.

## Releasing a new version

1. Bump the version in `package.json` (`npm version patch|minor|major`).
2. Merge/push to `main`.
3. `release.yml` fires, builds and publishes the image, and cuts a GitHub Release.

Or trigger `release.yml` manually from the **Actions** tab (it always builds on a
manual dispatch, regardless of version change).

## Required secrets

None. Everything uses the automatic `GITHUB_TOKEN`.

## Not wired up (fork notes)

Upstream published to npm and the MCP registry; those workflows were removed in
this fork. If you want to publish to npm or list in the MCP registry later, add
the corresponding workflow and its publisher/registry configuration.
