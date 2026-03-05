# ────────────────────────────────────────────────────────────────────
# Jowork — Multi-stage Docker build
# Stage 1: deps    → install all dependencies
# Stage 2: builder → compile TypeScript
# Stage 3: runtime → lean production image
# ────────────────────────────────────────────────────────────────────

# ── Stage 1: Install dependencies ─────────────────────────────────────
FROM node:22-bookworm-slim AS deps

RUN corepack enable pnpm

WORKDIR /app

# Copy workspace manifests first (maximise layer cache)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json   ./packages/core/package.json
COPY packages/premium/package.json ./packages/premium/package.json
COPY apps/jowork/package.json      ./apps/jowork/package.json
COPY apps/fluxvita/package.json    ./apps/fluxvita/package.json

# Install production + dev deps (needed for build)
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ─────────────────────────────────────────────────────
FROM deps AS builder

# Copy full source
COPY tsconfig.base.json tsconfig.json ./
COPY packages/ ./packages/
COPY apps/jowork/ ./apps/jowork/
COPY public/ ./public/

# Build core package first, then jowork app
RUN pnpm --filter @jowork/core build
RUN pnpm --filter @jowork/app  build

# ── Stage 3: Runtime ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="Jowork" \
      org.opencontainers.image.description="Open-source AI work partner" \
      org.opencontainers.image.url="https://github.com/fluxvita/jowork" \
      org.opencontainers.image.licenses="AGPL-3.0"

RUN corepack enable pnpm

WORKDIR /app

# Copy workspace manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json   ./packages/core/package.json
COPY packages/premium/package.json ./packages/premium/package.json
COPY apps/jowork/package.json      ./apps/jowork/package.json
COPY apps/fluxvita/package.json    ./apps/fluxvita/package.json

# Production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output from builder
COPY --from=builder /app/packages/core/dist  ./packages/core/dist
COPY --from=builder /app/apps/jowork/dist    ./apps/jowork/dist

# Copy static frontend files
COPY --from=builder /app/apps/jowork/public  ./apps/jowork/public
COPY --from=builder /app/public              ./public

# Data directory for SQLite + uploads
RUN mkdir -p /app/data /app/logs && chown -R node:node /app/data /app/logs

# Security: run as non-root
USER node

# Default port (override via JOWORK_PORT env)
EXPOSE 9800

ENV NODE_ENV=production \
    JOWORK_PORT=9800 \
    JOWORK_EDITION=free \
    DATA_DIR=/app/data \
    LOG_DIR=/app/logs

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9800/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/jowork/dist/index.js"]
