FROM node:22-slim AS base
RUN corepack enable pnpm

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/tsconfig.json packages/core/
COPY apps/cloud/package.json apps/cloud/tsconfig.json apps/cloud/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @jowork/cloud...

# Copy source
COPY packages/core/src packages/core/src
COPY apps/cloud/src apps/cloud/src

# Build
RUN pnpm --filter @jowork/core build && pnpm --filter @jowork/cloud build

# Runtime
FROM node:22-slim
WORKDIR /app
COPY --from=base /app/apps/cloud/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/cloud/node_modules ./apps/cloud/node_modules

ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/server.js"]
