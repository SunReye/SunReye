# SunReye

## Installation

1. Settings → Add-ons → Add-on store → ⋮ → **Repositories** → add
   `https://github.com/SunReye/SunReye`.
2. Install **SunReye** and start it. The first boot initializes the embedded
   database and runs schema migrations — give it a minute.
3. Open the sidebar panel. The first account you register becomes the admin;
   registration closes afterwards. The onboarding flow picks the inverter
   profile and connection.

No configuration is required to try it out: enable `inverter_simulate` and the
whole stack runs on synthetic data.

## Inverter connection

`inverter_host`, `inverter_port`, `inverter_unit_id`, `inverter_transport`,
and `inverter_profile` only **seed** the configuration on first run. After
onboarding, the connection is managed in the SunReye UI (Settings) — changing
the addon options later does not override it.

Use `inverter_transport: rtu-over-tcp` for RS485→Ethernet gateways that tunnel
RTU frames.

## MQTT & Home Assistant discovery

With the Mosquitto broker addon installed, MQTT is wired up automatically
(credentials come from the Supervisor) and `ha_discovery` (default on)
publishes retained discovery configs, so SunReye entities appear in Home
Assistant by themselves. To use a different broker, set `mqtt_broker_url`
(+ `mqtt_username` / `mqtt_password`).

## Direct access & REST API

Ingress is the primary door. To reach SunReye without ingress — for the
`/api/v1` REST API or a plain browser tab — map the disabled-by-default port
**8100** in the addon's network configuration. UI and API share that port;
third-party integrations call `http://<host>:8100/api/v1/...` with an API key
from the `api_keys` option (`Authorization: Bearer <key>` or `x-api-key`).

Leave `secure_cookies` off unless Home Assistant itself is served over HTTPS —
over plain HTTP the browser drops `Secure` session cookies and login silently
fails.

## Database

By default a TimescaleDB-enabled PostgreSQL runs inside the addon with its
data in `/data/postgres`. It survives addon updates and is part of HA backups.

To use an external database instead (e.g. the community TimescaleDB addon),
set `external_database_url` (`postgresql://user:password@host:5432/dbname`).
The database must have the TimescaleDB extension available; SunReye creates
its schema and hypertables itself. Migrating data between the two modes is not
automatic.

## Backups & restore

- **Automatic pre-upgrade backup**: whenever the addon version changes, a
  logical dump is written to `/data/backups` before migrations run
  (`backups_keep` rotates them).
- **HA backups**: a fresh dump is taken right before every Home Assistant
  backup (`backup_pre`), so the backup always contains a consistent
  `/data/backups/ha-backup-*.dump`. That dump — not the raw copy of the
  running datadir — is the reliable restore path.
- By default dumps exclude the raw 1 Hz sample window (re-collected within
  days; all long-horizon history lives in the rollups, which are included).
  Set `backup_full: true` to dump everything.

To restore a dump into a fresh addon install, from the addon's terminal:

```sh
psql -d "$DATABASE_URL" -c "SELECT timescaledb_pre_restore();"
pg_restore -d "$DATABASE_URL" --no-owner /data/backups/<file>.dump
psql -d "$DATABASE_URL" -c "SELECT timescaledb_post_restore();"
```

## Upgrades

Upgrades are designed to be boring:

- Schema changes ship as journaled migrations, applied automatically before
  the server starts; a failed migration stops the addon with the error as the
  last log lines and the database untouched mid-transaction.
- A pre-upgrade dump is taken automatically (see Backups).
- **Downgrade guard**: an older addon refuses to start against a database
  migrated by a newer one. To roll back, restore the pre-upgrade dump.
- The embedded PostgreSQL major version is pinned; a future major bump ships
  as a dedicated transition release with its own instructions, and the addon
  refuses to start rather than corrupt a mismatched data directory.

## Troubleshooting

- **Addon stops right after starting**: check the log — a failed migration,
  a PostgreSQL major mismatch, or an unreachable `external_database_url` stop
  the boot chain on purpose.
- **Login fails silently**: you probably enabled `secure_cookies` while using
  plain-HTTP Home Assistant.
- **Watchdog restarts**: `/healthz` (through the ingress port) fails when the
  database stops answering; look at the database log lines first.
