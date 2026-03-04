# Jowork — Docker image
# ghcr.io/fluxvita/jowork:latest
#
# Multi-stage build:
#   1. builder  — install deps + compile TypeScript
#   2. runtime  — minimal Node.js image, no dev deps

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /build

# Install pnpm
RUN npm install -g pnpm@10 --silent

# Copy manifests first for better layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/core/package.json          ./packages/core/
COPY packages/premium/package.json       ./packages/premium/
COPY apps/jowork/package.json            ./apps/jowork/
COPY apps/fluxvita/package.json          ./apps/fluxvita/

# Install all deps (including dev)
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/ ./packages/
COPY apps/jowork/ ./apps/jowork/
COPY apps/fluxvita/ ./apps/fluxvita/

# Build core → app
RUN pnpm --filter @jowork/core build
RUN pnpm --filter @jowork/app build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

ENV NODE_ENV=production \
    JOWORK_IN_DOCKER=1 \
    JOWORK_DATA_DIR=/app/data \
    JOWORK_LOG_DIR=/app/logs \
    PORT=18800

WORKDIR /app

# Install pnpm (needed for workspace hoisting)
RUN npm install -g pnpm@10 --silent

# Copy manifests + lockfile
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/core/package.json          ./packages/core/
COPY apps/jowork/package.json            ./apps/jowork/

# Copy compiled output + public assets
COPY --from=builder /build/packages/core/dist/   ./packages/core/dist/
COPY --from=builder /build/apps/jowork/dist/     ./apps/jowork/dist/
COPY apps/jowork/public/                          ./apps/jowork/public/

# Install production deps only
RUN pnpm install --frozen-lockfile --prod

# Create data + log dirs
RUN mkdir -p /app/data /app/logs

# Non-root user
RUN useradd -m -u 1001 jowork && chown -R jowork:jowork /app
USER jowork

EXPOSE 18800

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:18800/health || exit 1

CMD ["node", "apps/jowork/dist/index.js"]
