# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Home Assistant addon image: the whole SunReye stack in one container.
#
#   server (bun binary, 0.0.0.0:8099) — dashboard, API, /ws, /healthz
#     the SvelteKit build is embedded in the binary (--asset), so this is the
#     front door itself; nginx used to sit in front and is gone
#   postgres/timescaledb (127.0.0.1:5432, datadir /data/postgres)
#   migrate (same binary as the server, `sunreye migrate`, gates server start)
#
# 8099 serves both doors: the Supervisor proxies ingress to it, and the user
# may publish it for direct LAN access (disabled by default). One listener is
# why nginx could go — Elysia builds the /ws handlers inside .listen() and does
# not expose them, so a second Bun.serve would drop the live socket.
#
# Supervised by the HA base image's s6-overlay v3 — see rootfs/etc/s6-overlay.
# Built per-arch (amd64/aarch64) by .github/workflows/docker-addon.yml with the
# matching BUILD_FROM base.
# ─────────────────────────────────────────────────────────────────────────────

# Global arg (must precede the first FROM to be usable in one): per-arch HA
# base image, passed by the workflow from build.yaml.
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:bookworm

# ─── Build stage: pinned to the build platform, cross-compiles per TARGETARCH ─
# bun 1.4, not 1.3: directory embedding via `--asset` landed in 1.4. On 1.3 the
# flag exists in the help output as `--asset-naming` only, and the build fails
# with `ModuleNotFound resolving "apps/web/build" (entry point)` — bun takes the
# directory for a second entry point. Kept equal to apps/server/Dockerfile's
# pin, asserted in scripts/packaging.test.ts.
FROM --platform=$BUILDPLATFORM oven/bun:1.4 AS build
WORKDIR /app
ENV HUSKY=0 SKIP_ENV_VALIDATION=1 NODE_ENV=production

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

# The dashboard the binary serves (hash router, no server routes). Must run
# BEFORE the compile below: --asset reads the directory at build time, and a
# missing one is a hard build error. Architecture-independent.
RUN cd apps/web && bun run build:static

ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) BUN_TARGET=bun-linux-x64 ;; \
      arm64) BUN_TARGET=bun-linux-arm64 ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    mkdir -p /out && \
    # One binary for server + migrate (main.ts dispatches on argv) — each
    # compiled output embeds the ~90 MB bun runtime, so shipping two doubles
    # that cost for nothing.
    # --external serialport: see apps/server/Dockerfile — bun's bundler breaks
    # on @serialport/bindings-cpp, and the serial path is never used.
    # --asset embeds the whole build tree; bun keeps only its BASENAME, so it
    # arrives as build/… inside the binary — see src/web/loaded.ts. The path is
    # relative to the repo root here, NOT to apps/server as in the server
    # image: a wrong one still compiles and 404s every dashboard path.
    bun build --compile --minify --external serialport --target="$BUN_TARGET" --asset apps/web/build apps/server/src/main.ts --outfile /out/sunreye

# ─── Runtime stage: HA debian base (s6-overlay v3 + bashio, glibc) ───────────
FROM $BUILD_FROM

# Pinned database stack. The datadir under /data/postgres is only compatible
# with this pg major, and the timescaledb loader must be >= the extension
# version stamped into the user's database — bump both deliberately with a
# release (the version guard in init-postgres refuses mismatched datadirs).
ARG PG_MAJOR=17
# A FULL patch version, not `2.28`: the apt patterns below are wildcards, so a
# minor-only value floats to whatever patch packagecloud has newest (2.28.3
# today) and two builds of the same commit can ship different extension binaries.
# Kept equal to docker/timescaledb/Dockerfile — one extension version across the
# addon and the dev/CI database — asserted by scripts/storage-tuning.ts.
ARG TIMESCALEDB_VERSION=2.28.2
# The toolkit versions independently of the extension.
ARG TIMESCALEDB_TOOLKIT_VERSION=1.25.0
ENV PG_MAJOR=${PG_MAJOR}

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg git openssl \
    # PGDG for a pinned postgres major; Timescale's packagecloud repo for the extension.
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey \
       | gpg --dearmor -o /usr/share/keyrings/timescaledb.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/timescaledb.gpg] https://packagecloud.io/timescale/timescaledb/debian bookworm main" \
       > /etc/apt/sources.list.d/timescaledb.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       "postgresql-${PG_MAJOR}" \
       "timescaledb-2-postgresql-${PG_MAJOR}=${TIMESCALEDB_VERSION}*" \
       "timescaledb-2-loader-postgresql-${PG_MAJOR}=${TIMESCALEDB_VERSION}*" \
    # The baseline schema's weighted rollups need time_weight('LOCF', …) and
    # counter_agg. The addon and the dev/CI image must carry the same extensions
    # or a migration passes on one and fails on the other.
       "timescaledb-toolkit-postgresql-${PG_MAJOR}=1:${TIMESCALEDB_TOOLKIT_VERSION}*" \
    # gnupg was only needed to dearmor the repo keys above.
    && apt-get purge -y gnupg && apt-get autoremove -y --purge \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    # The timescaledb deb ships a versioned .so for every release since 2.17
    # (~420 MB) so *any* old datadir can load. Our embedded datadirs only ever
    # exist at versions this addon shipped, so keep just the current minor.
    # RULE for future TIMESCALEDB_VERSION bumps: also keep the minor shipped
    # by the previous addon release — the loader needs the old .so to open the
    # datadir before init-timescale-ext runs ALTER EXTENSION UPDATE.
    && find "/usr/lib/postgresql/${PG_MAJOR}/lib" -name 'timescaledb-*.so' \
       ! -name "timescaledb-${TIMESCALEDB_VERSION}.*" \
       ! -name "timescaledb-tsl-${TIMESCALEDB_VERSION}.*" -delete \
    # PGDG's postgresql hard-depends on LLVM for JIT (~150 MB with bitcode).
    # Our workload (1 Hz inserts + rollup reads) never benefits from JIT —
    # init-postgres pins `jit = off`, so the machinery can go entirely.
    && dpkg --purge --force-depends $(dpkg-query -W -f '${Package} ' 'libllvm*') \
    && rm -rf "/usr/lib/postgresql/${PG_MAJOR}/lib/bitcode" \
       "/usr/lib/postgresql/${PG_MAJOR}/lib/llvmjit"* \
    && useradd --system --no-create-home --shell /usr/sbin/nologin sunreye \
    # Debian's postgres tooling isn't on PATH by default.
    && ln -s "/usr/lib/postgresql/${PG_MAJOR}/bin/"* /usr/local/bin/

COPY --from=build /out/sunreye /opt/sunreye/sunreye
# The compiled migrate binary reads the SQL as plain files (MIGRATIONS_DIR /
# TIMESCALE_DIR are set by init-env).
COPY --from=build /app/packages/db/src/migrations /opt/sunreye/db/migrations
COPY --from=build /app/packages/db/src/timescale /opt/sunreye/db/timescale

# Build context is the repo root (the image needs the whole monorepo).
COPY sunreye/rootfs /

# Exit the container when a stage2 service fails to start (a failed oneshot in
# the boot chain — migration failure, pg major mismatch — must surface as a
# stopped addon, not a half-running one).
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    NODE_ENV=production

ARG BUILD_ARCH=amd64
ARG BUILD_VERSION=dev
ENV SUNREYE_ADDON_VERSION=${BUILD_VERSION}
LABEL io.hass.type="addon" \
      io.hass.arch="${BUILD_ARCH}" \
      io.hass.version="${BUILD_VERSION}"

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s \
  CMD curl -fsS http://127.0.0.1:8099/healthz || exit 1
