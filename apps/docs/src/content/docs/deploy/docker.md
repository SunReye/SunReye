---
title: Docker Compose
description: Build and run SunReye and its database with Docker Compose.
---

The root `docker-compose.yml` builds and runs the full stack from one Dockerfile,
`apps/server/Dockerfile`, plus a **TimescaleDB** database. That single image is the whole
application — dashboard, REST API, live socket and the schema migrator — because the
SvelteKit build is embedded in the compiled binary and `src/main.ts` dispatches on argv.

It ships on `scratch`: no shell, no package manager, no JS runtime, ~35 MB. There is no
longer a separate web image (a Node runtime) or migrate image (a 430 MB bun toolchain), and
one artifact is what makes the schema unable to drift from the code querying it.

## Commands

```bash
bun run docker:build   # build images
bun run docker:up      # build & start (detached)
bun run docker:logs    # tail logs
bun run docker:down    # stop
```

## Services and ports

| Service | Image / build | Host port |
| --- | --- | --- |
| `server` | `apps/server/Dockerfile` | `3000` |
| `migrate` | same image, `command: ["migrate"]` (run-once) | — |
| `postgres` | `ghcr.io/sunreye/timescaledb:pg17-ts2.28.2` (pinned) | `5432` |

Everything is on **[http://localhost:3000](http://localhost:3000)** — dashboard, API and
OpenAPI docs.

The database image is SunReye's own: `postgres:17-bookworm` plus a pinned TimescaleDB and
**timescaledb_toolkit**, built from `docker/timescaledb/Dockerfile`. The upstream
`timescale/timescaledb` images carry no toolkit at any tag, and the schema's time-weighted
rollups need its `time_weight` and `counter_agg` aggregates — the same image is used by the local dev database, by CI and inside the
Home Assistant addon, so a migration can never pass in one place and fail in another.

The embedded dashboard is the **hash-router** build, the same one the Home Assistant addon
serves so it survives a reverse-proxy path prefix. Routes therefore read
`http://localhost:3000/#/statistics`.

## Configuration

- The server reads `apps/server/.env`, which is optional in Compose (`required: false`).
- `docker-compose.yml` overrides `DATABASE_URL` to point at the `postgres` service. Set
  `POSTGRES_PASSWORD` in your environment to override the default (`password`).
- **Leave `CORS_ORIGIN` unset.** The dashboard is same-origin with the API now, so browsers
  enforce the boundary for you and CORS stays off — the safe default. Set it only if you
  serve the dashboard from a different host.
- **`PUBLIC_SERVER_URL` is not used by this stack.** The embedded dashboard resolves the API
  from the document URL, which is what keeps reverse-proxy path prefixes (HA ingress)
  intact. It still applies if you run the SvelteKit app yourself, split-origin.

See the [Environment Variables](/reference/environment/) reference for every value.

### Set the time zone

Containers run on UTC unless told otherwise, and the server cuts every day, month and
tariff-band boundary in its own local clock. On UTC, a household two hours east has its
evening peak billed to the following day, and "this month" opens two hours into the last
one — so the month chart carries a stray bar from the previous month.

Set `TZ` to the site's IANA zone (the published Compose file passes it through from `.env`):

```bash
TZ=Europe/Berlin
```

The browser follows its own system zone, so keep the two the same. A phone in another
country will draw the day boundaries where the server put them.

## Notes

- **The image is `scratch`** — no shell, node, or curl inside. Its healthcheck runs the
  server binary itself (`/app/server --healthcheck`), which probes `/healthz` and
  round-trips the database. The binary is not statically linked, so the image does carry
  musl's loader, `libstdc++`/`libgcc_s`, the CA bundle and the IANA zone database: without
  the last two, outbound HTTPS fails and every day boundary is cut in UTC.
- The `postgres` service has a `pg_isready` healthcheck and the server waits for it
  (`service_healthy`) before starting.
- The Postgres image tag is **pinned**: the data volume is only compatible with the pg major
  that created it, and the timescaledb extension binary must be ≥ the version stamped in the
  database. Tag bumps ship deliberately with releases.
- Database data persists in the `SunReye_postgres_data` volume.

## Schema migrations

Automatic. The **`migrate`** service is the server image run as `migrate`; it invokes the
journaled migration runner (`packages/db/src/migrate.ts`) against the Compose Postgres, then
exits. The `server` waits for it to complete (`service_completed_successfully`) before
starting. The runner reads its SQL as plain files, so the image carries
`packages/db/src/{migrations,timescale}` and points `MIGRATIONS_DIR` / `TIMESCALE_DIR` at
them. The runner:

1. **Refuses downgrades** — an older release won't start against a database migrated by a
   newer one (restore a backup instead).
2. **Baselines pre-journal databases** — deployments created in the old `db:push` era get
   the baseline migration recorded without re-executing it.
3. Applies pending drizzle migrations transactionally, then the TimescaleDB pipeline
   (journaled structural files + re-applied policies).

A failed migration exits non-zero, the server never starts, and the error is the last thing
in `docker compose logs migrate`. Nothing can prompt interactively — the old `db:push` hang
is gone.
