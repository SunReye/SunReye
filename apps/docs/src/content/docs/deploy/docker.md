---
title: Docker Compose
description: Build and run the SunReye web + server + database with Docker Compose.
---

The root `docker-compose.yml` builds and runs the full stack: the **web** dashboard, the
**server** (core engine), and a **TimescaleDB** database. The app Dockerfiles live at
`apps/web/Dockerfile` and `apps/server/Dockerfile`.

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
| `web` | `apps/web/Dockerfile` | `3001` |
| `server` | `apps/server/Dockerfile` | `3000` |
| `migrate` | `docker/migrate.Dockerfile` (run-once) | — |
| `postgres` | `timescale/timescaledb:2.28.2-pg17` (pinned) | `5432` |

The dashboard is served on **[http://localhost:3001](http://localhost:3001)** and the API
on **[http://localhost:3000](http://localhost:3000)**.

## Configuration

- Each app reads its own `.env` (`apps/web/.env`, `apps/server/.env`), which are optional in
  Compose (`required: false`).
- `docker-compose.yml` overrides a few values for container networking:
  - `server` gets `CORS_ORIGIN=http://localhost:3001` and a `DATABASE_URL` pointing at the
    `postgres` service.
  - Set `POSTGRES_PASSWORD` in your environment to override the default (`password`).
- **`PUBLIC_SERVER_URL` is read at runtime** (container start), not baked into the image.
  It tells the *browser* where to reach the API and defaults to `http://localhost:3000`;
  override it in the `web` service environment when the API lives elsewhere. Left unset,
  the web client falls back to same-origin resolution (used by the Home Assistant addon's
  reverse proxy).

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

- **The server image is distroless** — no shell, node, or curl inside. Its healthcheck runs
  the server binary itself (`/app/server --healthcheck`), which probes `/healthz` and
  round-trips the database; `web` waits for `service_healthy`.
- The `postgres` service has a `pg_isready` healthcheck and the server waits for it
  (`service_healthy`) before starting.
- The Postgres image tag is **pinned**: the data volume is only compatible with the pg major
  that created it, and the timescaledb extension binary must be ≥ the version stamped in the
  database. Tag bumps ship deliberately with releases.
- Database data persists in the `SunReye_postgres_data` volume.

## Schema migrations

Automatic. The **`migrate`** service runs the journaled migration runner
(`packages/db/src/migrate.ts`) against the Compose Postgres, then exits; the `server` waits
for it to complete (`service_completed_successfully`) before starting. The runner:

1. **Refuses downgrades** — an older release won't start against a database migrated by a
   newer one (restore a backup instead).
2. **Baselines pre-journal databases** — deployments created in the old `db:push` era get
   the baseline migration recorded without re-executing it.
3. Applies pending drizzle migrations transactionally, then the TimescaleDB pipeline
   (journaled structural files + re-applied policies).

A failed migration exits non-zero, the server never starts, and the error is the last thing
in `docker compose logs migrate`. Nothing can prompt interactively — the old `db:push` hang
is gone.
