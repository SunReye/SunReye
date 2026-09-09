---
title: Home Assistant Addon
description: Run the whole SunReye stack as a Home Assistant OS addon with ingress, backups, and automatic migrations.
---

SunReye ships as a first-class Home Assistant addon: one container with the core engine,
the dashboard and an embedded TimescaleDB — the UI lives in the HA sidebar via ingress, and
`/data` (including the database) is covered by HA backups.

## Install

1. **Settings → Add-ons → Add-on store → ⋮ → Repositories** and add
   `https://github.com/SunReye/SunReye`.
2. Install **SunReye** and start it. First boot initializes the database and runs
   migrations — give it a minute.
3. Open the sidebar panel. The first registered account becomes the admin; registration
   closes afterwards.

The addon manifest and full option reference live in [`sunreye/`](https://github.com/SunReye/SunReye/tree/master/sunreye)
(`config.yaml`, `DOCS.md`).

## Architecture

```
HA ingress (sidebar)   optional direct access (same port, off by default)
        │                             │
        └──────► server (bun binary, 0.0.0.0:8099) ◄──────┘
                 /api /ws /openapi /healthz        one origin, no CORS
                 everything else → SvelteKit build embedded in the binary
                                   TimescaleDB (127.0.0.1, /data/postgres)
```

One listener, no reverse proxy. nginx used to sit in front and serve the SPA off disk;
the build is embedded in the binary now (`bun build --asset`), so the two copies of the
routing and cache-control rules became one. Ingress and direct access share container
port **8099** — the cost of that is in [Direct access](#options-worth-knowing) below.

Startup is a supervised chain: postgres → readiness → `ALTER EXTENSION timescaledb UPDATE`
→ pre-upgrade backup → migration runner → server. Any failure stops the addon
with the cause as the last log lines — the server never runs against a half-migrated
database.

## Options worth knowing

- `inverter_*` — seed the connection config on first run only; afterwards manage it in the
  SunReye UI. `inverter_simulate: true` runs the stack with synthetic data.
- `external_database_url` — use an external PostgreSQL+TimescaleDB instead of the embedded
  one.
- `api_keys` + direct access on container port `8099` — third-party REST access
  (`http://<host>:<port>/api/v1`). Disabled until you assign a host port. It is the same
  port ingress uses, so publishing it also drops the Supervisor-only restriction nginx
  used to enforce: other add-ons on HA's internal network can then reach the login page
  (rate-limited, and ingress grants no elevated trust). Users upgrading from the nginx
  era must re-map: the old port was `8100`.
- MQTT auto-wires from the Mosquitto addon; `ha_discovery` (default on) makes SunReye
  entities appear in HA automatically.

## Upgrades & backups

- **Pre-upgrade dump**: on the first start after a version change, a logical dump lands in
  `/data/backups` (rotated, `backups_keep`).
- **HA backups** trigger a fresh dump (`backup_pre`) so every backup contains a consistent
  restore file — the dump, not the raw datadir copy, is the restore path.
- **Downgrade guard**: an older addon refuses to start against a newer schema; restore the
  pre-upgrade dump to roll back.
- The embedded PostgreSQL major is pinned and guarded; major bumps ship as dedicated
  transition releases.
