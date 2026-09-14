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
`inverter_logger_serial` and `inverter_profile` only **seed** the configuration
on first run. After onboarding, the connection is managed in the SunReye UI
(Settings) — changing the addon options later does not override it.

Pick the transport that matches what the inverter is plugged into:

- **`solarman-v5`** — the Solarman/IGEN WiFi logger stick that most Deye,
  Sunsynk and Sofar hybrids already ship with. Nothing to buy and nothing to
  wire: point `inverter_host` at the stick's IP and set `inverter_port: 8899`.
  Leave `inverter_logger_serial` empty — SunReye reads the serial off the stick
  when you test the connection. (Empty, not `0`: on the wire `0` is the
  "whichever stick answers" serial, not a number a stick has, and the addon
  refuses it.) You can keep using the Solarman app: the stick takes both
  clients at once and evicts neither, it just serves them one after the other
  over the single RS485 line to the inverter. A full poll of a Deye SG05LP3
  (99 metrics) measures about **0.7 s** on an idle stick, and a second client
  roughly doubles that. If it is tight, raise `poll_interval_ms` — a slower
  poll costs resolution and nothing else. Verified on firmware
  `LSW3_32_5406_SS_04_00.00.00.0A`; older LSW/LSE sticks are untested.
- **`rtu-over-tcp`** — RS485→Ethernet gateways that tunnel raw RTU frames,
  usually on port 502.
- **`tcp`** — a native Modbus TCP inverter, or a gateway that converts the
  protocol itself.

## MQTT & Home Assistant discovery

With the Mosquitto broker addon installed, MQTT is wired up automatically
(credentials come from the Supervisor) and `ha_discovery` (default on)
publishes retained discovery configs, so SunReye entities appear in Home
Assistant by themselves. To use a different broker, set `mqtt_broker_url`
(+ `mqtt_username` / `mqtt_password`).

## Direct access & REST API

Ingress is the primary door. To reach SunReye without ingress — for the
`/api/v1` REST API or a plain browser tab — assign a host port to the
disabled-by-default **8099** in the addon's network configuration. Dashboard
and API share that port; third-party integrations call
`http://<host>:<port>/api/v1/...` with an API key from the `api_keys` option
(`Authorization: Bearer <key>` or `x-api-key`).

> **Changed in this release.** The direct port used to be **8100**, served by a
> separate nginx vhost. The server serves the dashboard itself now, so there is
> one listener and it is 8099 — the same port ingress uses. If you had mapped
> 8100, that mapping is gone and you need to assign a host port to 8099
> instead. Two consequences worth knowing: nginx used to answer 8099 with
> `allow 172.30.32.2; deny all`, keeping other add-ons on Home Assistant's
> internal network away from it, and one socket cannot both allow-list the
> Supervisor and accept your LAN — so another add-on can now reach the login
> page. It is rate-limited and ingress grants no elevated trust, so this is not
> a way into your data, but it is less isolation than before.

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

To restore a dump into a fresh addon install, run the restore script — it is the
only place the sequence lives (the TimescaleDB pre/post-restore bracket, the
`pg_restore` invocation, and the refusals), and CI restores real dumps with it on
every release:

```sh
scripts/db-restore.sh /data/backups/<file>.dump
```

It refuses, before writing anything, when the target database was migrated by a
newer SunReye release than the dump, or when it already holds SunReye data —
pass `--force` to overwrite the latter deliberately. Restore into a fresh
database and start SunReye afterwards; migrations bring the schema current.

A dump taken with the default `backup_full: false` restores all history (the
rollups) but no raw 1 Hz samples: the last days of second-resolution detail are
gone and collection resumes from now.

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
- **Spikes in computed metrics (efficiency, self-consumption)**: the registers
  feeding a computed metric are sampled in one spanning Modbus read so they all
  reflect the same instant; that read also touches the unmapped register
  addresses between them. Two limitations: (a) a device that rejects such a
  read (illegal data address) automatically falls back to split reads — visible
  as a warning in the log; (b) input registers more than 120 apart can never
  share a transaction (Modbus caps a single read). In both cases the inputs are
  sampled milliseconds apart, so a fast power swing between those reads can/will
  produce a transient spike in the computed value for one sample.
