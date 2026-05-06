# syntax=docker/dockerfile:1.7
# Build context is the repo root.

FROM node:22-bookworm-slim AS base
# y-leveldb pulls leveldown which compiles native code via node-gyp.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json ./packages/db/
COPY apps/web/package.json ./apps/web/
COPY apps/ws/package.json ./apps/ws/
COPY apps/cleanup/package.json ./apps/cleanup/
RUN pnpm install --frozen-lockfile --filter @piepad/ws...

FROM deps AS runtime
COPY tsconfig.base.json ./
COPY packages/db ./packages/db
COPY apps/ws ./apps/ws
ENV NODE_ENV=production

# LevelDB volume mount lands here.
RUN mkdir -p /data/yjs
ENV LEVELDB_PATH=/data/yjs

EXPOSE 1234
WORKDIR /app/apps/ws
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
