FROM node:22-slim
RUN corepack enable pnpm

WORKDIR /app

# Copy workspace config + lockfile for caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/tsconfig.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY apps/cloud/package.json apps/cloud/tsconfig.json apps/cloud/

# Install all deps (tsx needed at runtime for TS imports)
RUN pnpm install --frozen-lockfile --filter @jowork/cloud...

# Copy source (core exports TS directly, tsx handles it at runtime)
COPY packages/core/src packages/core/src
COPY apps/cloud/src apps/cloud/src

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

COPY apps/cloud/drizzle.config.ts apps/cloud/
COPY apps/cloud/public apps/cloud/public
COPY apps/cloud/start.sh apps/cloud/
RUN chmod +x apps/cloud/start.sh

CMD ["sh", "apps/cloud/start.sh"]
