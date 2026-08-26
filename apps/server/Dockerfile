# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Build stage
# Pinned to the *build* platform so multi-arch images cross-compile natively
# (no QEMU emulation of the toolchain). `bun build --compile` produces a single,
# fully self-contained binary — all npm deps are bundled in, so the runtime
# image needs no node_modules and no JS runtime.
# ─────────────────────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM oven/bun:1.4 AS build
WORKDIR /app
ENV HUSKY=0 SKIP_ENV_VALIDATION=1 NODE_ENV=production

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) BUN_TARGET=bun-linux-x64 ;; \
      arm64) BUN_TARGET=bun-linux-arm64 ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    cd apps/server && \
    # --external serialport: modbus-serial only requires it inside its
    # RTU-over-serial connectors (never used — SunReye speaks TCP), and bun's
    # bundler emits a syntax error into the bundled @serialport/bindings-cpp
    # wrapper that breaks parsing of the whole binary at startup.
    bun build --compile --minify --external serialport --target="$BUN_TARGET" ./src/index.ts --outfile /app/server

# ─────────────────────────────────────────────────────────────────────────────
# Runtime stage
# distroless/base ships glibc + ca-certificates + tzdata and nothing else.
# The compiled binary only links against glibc (libc, libm, libpthread, libdl),
# so this is all it needs. Runs as the built-in non-root user (uid 65532).
# ─────────────────────────────────────────────────────────────────────────────
FROM gcr.io/distroless/base-debian12:nonroot AS runtime
WORKDIR /app
COPY --from=build /app/server /app/server
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["/app/server"]
