# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Build stage
# The SvelteKit adapter-node output is plain, architecture-independent JS, so we
# build once on the build platform even for multi-arch images. adapter-node
# bundles every dependency into build/, so the runtime needs no node_modules.
# ─────────────────────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM oven/bun:1.4 AS build
WORKDIR /app
ENV HUSKY=0 SKIP_ENV_VALIDATION=1 NODE_ENV=production

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

# PUBLIC_SERVER_URL is read at *runtime* via $env/dynamic/public (see
# apps/web/src/lib/server-url.ts) — nothing is baked into the bundle, so one
# image serves every deployment topology.
RUN cd apps/web && bun run build

# ─────────────────────────────────────────────────────────────────────────────
# Runtime stage
# distroless/nodejs is just the Node runtime (its ENTRYPOINT is `node`).
# We copy only the self-contained build/ output. Runs as non-root (uid 65532).
# ─────────────────────────────────────────────────────────────────────────────
FROM gcr.io/distroless/nodejs24-debian12:nonroot AS runtime
WORKDIR /app
COPY --from=build /app/apps/web/build ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
EXPOSE 3001
CMD ["index.js"]
