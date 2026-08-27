# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# The ONE database image: dev, CI and the addon must carry the same extensions.
#
# Published as ghcr.io/sunreye/timescaledb:pg17-ts<version> by
# .github/workflows/db-image.yml, and consumed by docker-compose.yml,
# docker-compose.db.yml, docker/docker-compose.yml and the two workflows that
# stand a real Postgres up. scripts/storage-tuning.ts asserts all five agree.
#
# Why not an off-the-shelf image (measured, do not re-litigate):
#   timescale/timescaledb:2.28.2-pg17   445 MB, and carries NO timescaledb_toolkit
#                                       at any tag — the baseline schema needs
#                                       time_weight('LOCF', …) and counter_agg
#   timescale/timescaledb-ha:pg17       has the toolkit but is 1333 MB and moves
#                                       data_directory, which breaks the compose
#                                       volume mounts, healthchecks and env vars
#   this file                           postgres:17-bookworm + the pinned
#                                       extension + the toolkit + the same
#                                       versioned-.so prune the addon performs
#
# Deliberately NOT done here: entrypoint work. The compose files pass their
# storage tuning as additive `-c` flags, and data_directory stays at the
# postgres default /var/lib/postgresql/data so every existing volume mount and
# `pg_isready` healthcheck keeps working.
# ─────────────────────────────────────────────────────────────────────────────

FROM postgres:17-bookworm

# Pinned to a FULL patch version, identical to sunreye/Dockerfile's ARG (asserted
# by scripts/storage-tuning.ts). `2.28.*` is not a pin: it floats to whatever
# patch is newest, so two builds of the same commit can ship different extension
# binaries — and the addon's datadir compatibility rule is stated in terms of a
# known version.
ARG TIMESCALEDB_VERSION=2.28.2
# The toolkit versions independently of the extension.
ARG TIMESCALEDB_TOOLKIT_VERSION=1.25.0

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    # Timescale's packagecloud repo — the same gpgkey/repo lines as
    # sunreye/Dockerfile, on purpose: the two images must resolve the same debs.
    && curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey \
       | gpg --dearmor -o /usr/share/keyrings/timescaledb.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/timescaledb.gpg] https://packagecloud.io/timescale/timescaledb/debian bookworm main" \
       > /etc/apt/sources.list.d/timescaledb.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       "timescaledb-2-postgresql-${PG_MAJOR}=${TIMESCALEDB_VERSION}*" \
       "timescaledb-2-loader-postgresql-${PG_MAJOR}=${TIMESCALEDB_VERSION}*" \
       "timescaledb-toolkit-postgresql-${PG_MAJOR}=1:${TIMESCALEDB_TOOLKIT_VERSION}*" \
    # gnupg was only needed to dearmor the repo key above.
    && apt-get purge -y gnupg && apt-get autoremove -y --purge \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    # The timescaledb deb ships a versioned .so for every release since 2.17
    # (~420 MB) so *any* old datadir can load. A dev/CI database only ever
    # exists at the version this image pins, so keep just that one.
    # RULE for future TIMESCALEDB_VERSION bumps: also keep the minor shipped
    # by the previous release — the loader needs the old .so to open the datadir
    # before ALTER EXTENSION UPDATE runs. (Mirrors sunreye/Dockerfile.)
    && find "/usr/lib/postgresql/${PG_MAJOR}/lib" -name 'timescaledb-*.so' \
       ! -name "timescaledb-${TIMESCALEDB_VERSION}.*" \
       ! -name "timescaledb-tsl-${TIMESCALEDB_VERSION}.*" -delete

# timescaledb is a preload-only extension, and a GitHub Actions `services:` block
# cannot pass a command — so the default has to come from the image. Appending to
# the sample conf is initdb-time, not entrypoint work: the value lands in a fresh
# datadir's postgresql.conf, and the compose files' additive `-c` flags still win.
RUN echo "shared_preload_libraries = 'timescaledb'" \
      >> "/usr/share/postgresql/${PG_MAJOR}/postgresql.conf.sample" \
    && echo "timescaledb.telemetry_level = off" \
      >> "/usr/share/postgresql/${PG_MAJOR}/postgresql.conf.sample"
