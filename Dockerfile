# =============================================================================
# Multi-stage build for Komodo MCP Server (extended fork)
# =============================================================================
# Supported architectures: linux/amd64, linux/arm64, linux/arm/v7
#
# Build strategy for multi-arch:
# - All npm operations happen in the builder stage (avoids QEMU issues)
# - Production stage only copies pre-built artifacts
# - This prevents "Illegal instruction" crashes on ARM64 cross-compilation
#
# Security:
# - Runtime uses the built-in node user (UID 1000) with a nologin shell
# - Build artifacts owned by root (immutable for the runtime user)
# - tini as init system for proper signal handling
# =============================================================================

# Build arguments for metadata (passed from CI / docker build)
ARG VERSION=unknown
ARG BUILD_DATE=unknown
ARG COMMIT_SHA=unknown

# Use native platform for builder (avoids QEMU emulation issues with npm)
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

# Upgrade OS packages
RUN apk upgrade --no-cache

WORKDIR /app

# Copy package files first (better layer caching)
COPY package*.json ./

# Install all dependencies (including devDependencies for the TypeScript build)
RUN npm ci

# Copy only the source needed for the build (optimizes layer caching)
COPY tsconfig*.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build:prod

# Prune devDependencies - runs on the native platform (no QEMU), so npm works fine
RUN npm prune --omit=dev && npm cache clean --force

# =============================================================================
# Production stage
# =============================================================================

FROM node:22-alpine AS production

# Re-declare ARGs for this stage (needed for LABELs)
ARG VERSION
ARG BUILD_DATE
ARG COMMIT_SHA

# Upgrade OS packages and install tini for proper signal handling
RUN apk upgrade --no-cache && \
    apk add --no-cache tini

WORKDIR /app

# Copy build artifacts as root-owned (immutable for the runtime user)
COPY --from=builder --chown=root:root /app/node_modules ./node_modules
COPY --from=builder --chown=root:root /app/build ./build
COPY --from=builder --chown=root:root /app/package.json ./package.json

# Harden the built-in node user: change its shell to nologin (service account only)
RUN sed -i 's|/home/node:/bin/sh|/home/node:/sbin/nologin|' /etc/passwd

# Switch to the non-root user (built-in node user, UID 1000)
USER node

# Environment variables
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV MCP_BIND_HOST=0.0.0.0
ENV MCP_PORT=8000

# Expose the MCP port
EXPOSE ${MCP_PORT}

# Health check — verifies the MCP server is ready to accept traffic (http mode only).
# In stdio mode the check is skipped (always healthy).
# /ready returns: 200 (ready), 503 (Komodo configured but not connected),
# 429 (session limits reached). Uses Node's built-in fetch() — no curl/wget needed.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD if [ "$MCP_TRANSPORT" = "http" ] || [ "$MCP_TRANSPORT" = "https" ]; then \
    node -e "fetch('http://localhost:'+(process.env.MCP_PORT||8000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; \
  else exit 0; fi

# Container metadata labels (OCI standard)
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${COMMIT_SHA}" \
      org.opencontainers.image.title="Komodo MCP Server (extended)" \
      org.opencontainers.image.description="Model Context Protocol server for the Komodo container-orchestration API — extended fork" \
      org.opencontainers.image.source="https://github.com/ATreemanDork/komodo-mcp-server_extended" \
      org.opencontainers.image.documentation="https://github.com/ATreemanDork/komodo-mcp-server_extended#readme" \
      org.opencontainers.image.licenses="GPL-3.0" \
      org.opencontainers.image.authors="ATreemanDork" \
      io.modelcontextprotocol.server.name="io.github.ATreemanDork/komodo-mcp-server_extended"

# Use tini as the init system for proper signal handling (SIGTERM, SIGINT):
# ensures graceful shutdown and prevents zombie processes.
ENTRYPOINT ["/sbin/tini", "--"]

# Start the MCP server
CMD ["node", "build/index.js"]
