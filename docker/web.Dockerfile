# syntax=docker/dockerfile:1.7
# Build context is the repo root (compose `context: ../`).

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ---- deps ---------------------------------------------------------------
# Copy ONLY the manifests first so dependency installation caches well
# across source-only changes.
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json ./packages/db/
COPY apps/web/package.json ./apps/web/
COPY apps/ws/package.json ./apps/ws/
COPY apps/cleanup/package.json ./apps/cleanup/
RUN pnpm install --frozen-lockfile --filter @piepad/web...

# ---- build --------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/db ./packages/db
COPY apps/web ./apps/web
# Next.js inlines NEXT_PUBLIC_* into the client bundle at *build* time. The
# compose env_file only injects at runtime, so without a build ARG these
# fall through to whatever fallback the source code declares (e.g. the WS
# URL falls back to ws://localhost:1234, which silently breaks pads in
# production because no external connection ever reaches caddy).
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN pnpm --filter @piepad/web build

# ---- runtime ------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js standalone bundle includes its own pruned node_modules.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
