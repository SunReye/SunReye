---
title: Manual Setup
description: Run the SunReye dev servers directly with bun.
---

This is the development workflow: run the core engine and dashboard directly with bun,
against a local TimescaleDB container. For a containerized production install, see
[Docker Compose](/deploy/docker/).

## 1. Install dependencies

```bash
bun install
```

## 2. Provision the database

Run a local TimescaleDB via Docker Compose:

```bash
bun run db:start
```

This uses `docker-compose.db.yml`, which runs `timescale/timescaledb:latest-pg17` and
exposes it on `localhost:5432`.

:::note[Host networking]
The local DB container uses **host networking**. This is required for Docker running inside
an unprivileged Proxmox LXC, where bridged containers fail on the
`net.ipv4.ip_unprivileged_port_start` sysctl. It's reachable on `localhost:5432`, matching
the default `DATABASE_URL`.
:::

You can manage the container with `bun run db:watch` (tail logs), `bun run db:stop`, and
`bun run db:down`.

Alternatively, point at any existing PostgreSQL + TimescaleDB instance by setting
`DATABASE_URL` in `apps/server/.env`.

## 3. Configure environment

Set connection details in `apps/server/.env`. The only truly required server variables are
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `CORS_ORIGIN`; everything else
has a sensible default. See the full [Environment Variables](/reference/environment/)
reference.

:::tip
`INVERTER_SIMULATE` defaults to `true`, so you don't need any inverter configuration to get
started. Connection settings can be changed later from the [Settings](/use/settings/)
screen.
:::

## 4. Apply the schema and TimescaleDB objects

```bash
bun run db:migrate
```

Runs the journaled migration runner: the Drizzle schema plus the TimescaleDB pipeline
(hypertable, continuous-aggregate rollups, policies) — the same thing production
deployments run before starting the server. For quick local schema prototyping,
`bun run db:push` + `bun run db:timescale` still work, but anything that ships must be a
generated migration (`bun run db:generate`, see `packages/db/AGENTS.md`).

## 5. Start the dev servers

```bash
bun run dev
```

This starts the core engine, the web dashboard, and tails the database together. To run a
single app, use `bun run dev:web` or `bun run dev:server`.

## 6. Open

- **Dashboard:** [http://localhost:5173](http://localhost:5173)
- **API + OpenAPI docs:** [http://localhost:3000](http://localhost:3000)
  (Scalar UI at `/openapi`)

On first launch you'll go through [onboarding](/use/users/) to create the admin account.

See the [Scripts](/reference/scripts/) reference for the full list of workspace commands.
