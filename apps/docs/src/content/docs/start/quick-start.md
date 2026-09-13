---
title: Quick Start
description: Run the whole SunReye stack against the built-in simulator in five minutes — no hardware.
---

This gets you a running dashboard with live data in about five minutes, using the built-in
**simulator** — no inverter required. It uses [bun](https://bun.sh/) as the runtime and
package manager.

:::tip[No hardware needed]
`INVERTER_SIMULATE` defaults to `true`, so SunReye runs against a coherent fake inverter out
of the box. Point it at real hardware later from the [Settings](/use/settings/) screen.
:::

## Prerequisites

- [bun](https://bun.sh/) installed
- Docker (for the TimescaleDB database)

See [Requirements](/deploy/requirements/) for details.

## 1. Install dependencies

```bash
bun install
```

## 2. Start the database

This runs a TimescaleDB container via Docker Compose:

```bash
bun run db:start
```

## 3. Create the schema and TimescaleDB objects

```bash
bun run db:push
bun run db:timescale
```

`db:push` applies the Drizzle schema; `db:timescale` creates the hypertable and the
continuous-aggregate rollups.

## 4. Start everything

```bash
bun run dev
```

This starts the core engine, the web dashboard, and tails the database — all together.

## 5. Open the dashboard

- **Dashboard:** [http://localhost:5173](http://localhost:5173)
- **API + OpenAPI docs:** [http://localhost:3000](http://localhost:3000) — Scalar UI at
  [`/openapi`](http://localhost:3000/openapi)

On first run you'll be taken through [onboarding](/use/users/) to create the initial admin
account. After that, the dashboard renders live simulated data.

## What next?

- [Point it at a real inverter](/use/settings/#devices) under Settings → Devices.
- [Deploy with Docker Compose](/deploy/docker/) for a persistent install.
- [Explore the REST API](/integrations/rest-api/) or set up the
  [MQTT bridge](/integrations/mqtt/).
- [Author a profile](/profiles/authoring/) for an unsupported inverter.
