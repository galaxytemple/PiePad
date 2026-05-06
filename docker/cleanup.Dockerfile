# syntax=docker/dockerfile:1.7
# Build context is the repo root.

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json ./packages/db/
COPY apps/web/package.json ./apps/web/
COPY apps/ws/package.json ./apps/ws/
COPY apps/cleanup/package.json ./apps/cleanup/
RUN pnpm install --frozen-lockfile --filter @piepad/cleanup...

FROM deps AS runtime
COPY tsconfig.base.json ./
COPY packages/db ./packages/db
COPY apps/cleanup ./apps/cleanup
ENV NODE_ENV=production

WORKDIR /app/apps/cleanup
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
