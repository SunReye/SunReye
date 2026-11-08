---
title: Migrating from 3.x to 4.0
description: What 4.0 drops, how to bring a 3.x plant and its history across, and how to go back.
---

4.0 is a new core, not an update. There is no in-place upgrade: you export an archive from 3.x and
import it into a fresh 4.0. 3.x is never touched by the import, so it stays your way back.

## What 4.0 drops

4.0 reads inverters and never writes to them.

| 3.x | 4.0 |
| --- | --- |
| Manual [controls](/use/controls/) | Gone |
| [Automations](/use/automations/) (peak shaving, forecast charging) | Gone |
| MQTT `/set` commands | Gone |
| The optimizer | Gone |
| EVCC | Read-only ingest |
| Postgres / TimescaleDB | One SQLite file in `--data-dir` |
| Transports | Modbus TCP, RTU-over-TCP and Solarman V5 only |

Registers 3.x automation wrote stay as 3.x left them, which is why step 1 below is not optional.

## What the import carries

| Carried | Not carried |
| --- | --- |
| Plant time zone, location, label, export limit, house load, smart-meter date | Settings: MQTT, EVCC, prices, kiosk, retention |
| Connections and devices, each with its PV arrays, battery and loss figures | Automation settings and state |
| Readings in the raw, minute, hourly and daily tiers | The configuration-register log: read and checked, not kept |
| | User accounts, sessions and API keys |
| | Custom charts |

Re-enter what is not carried in 4.0 Settings. The archive holds no accounts, so 4.0 starts with a
fresh administrator.

The import refuses an archive it cannot keep, before it writes anything, and names the cause:

- A connection that is not Modbus over IP, for example a serial port: `connection Port is serial: 4.0 reads Modbus over IP only`.
- A device role other than inverter, meter, charger or controller.
- A profile that is neither built into 4.0 nor supplied by a profile source:
  `profile <id> is neither compiled in nor supplied by a profile source`. Add the profile source on
  the setup page, then import again.
- A missing, truncated or unreadable member, or a `readings` member whose row counts differ from
  `manifest.json`: `<member>: <reason>`.

## Migrate

### 1. Switch automation off in 3.x

In 3.x open [Settings → Automations](/use/settings/#automations) and turn the master switch off.
Switching off hands every register an automation held back to the value it had before.

3.x does not restore register values when it stops, so do this before you stop 3.x.

### 2. Export the archive from 3.x

In 3.x: **Settings → Danger Zone → Download export**. From a shell:

```bash
sunreye export --out /share/migration.tar.gz
```

The file is a gzipped tar: `manifest.json`, `config.json`, `config-log.ndjson.gz` and
`readings.ndjson.gz`. Each reading line names its tier in `source_tier` (`raw`, `minute`, `hourly`
or `daily`). See [Export & Import](/use/export-import/) for the format.

Export after step 1: an archive that records automation as on triggers
[the guard](#the-automation-guard). 3.x history after the export does not reach 4.0.

### 3. Start 4.0 on an empty data directory

Stop 3.x, then start 4.0 with `--data-dir` pointing at a directory with no store:

```bash
sunreye --data-dir /var/lib/sunreye --listen 0.0.0.0:8099
```

`--listen` defaults to `127.0.0.1:8099`, which only the host itself reaches.

### 4. Create the administrator

Open 4.0. **Welcome to SunReye** asks you to create the administrator. 3.x passwords are not
imported, so choose a new one: 8 characters to 72 UTF-8 bytes, no NUL character. A longer password is
refused, never shortened. Registration closes once the account exists; add other users in Settings.

### 5. Import the archive

The import runs only into a 4.0 with no device and only for an administrator.

1. **Set up your inverter** opens. Choose **Import a 3.x archive instead**.
2. **Import a 3.x archive**: choose the `.tar.gz` under **Archive (.tar.gz)**. The page shows
   **Uploading N%**, then **Importing…**. An archive is at most 512 MiB; a full 3.x history
   (about 9 million rows) is about a tenth of that. An upload that stalls for 60 seconds or lasts over 2 hours
   is refused: send it again.
3. If the archive turns automation on or still holds a register value, **Automation was on in 3.x**
   opens and nothing is written yet. See [the guard](#the-automation-guard).
4. **Import finished** lists the rows read per tier (**Raw readings**, **Minute buckets**,
   **Hourly buckets**, **Daily buckets**) and **Configuration log lines**. Choose **Continue** to open
   the dashboard.

Imports run one at a time. If the 4.0 already holds a device the upload is refused with
`The import cannot run now: the store already holds devices: import into a new store`. Delete the data
directory and start again.

The import is one transaction: it either lands whole or not at all. Afterwards 4.0 polls the imported
devices and the first non-retired device's profile becomes the active profile.

#### The automation guard

The dialog lists each held register as **Holder**, **Saved value** and **Saved at**. The holder is
3.x's `<device>:<automation>` key. With automation on but nothing held it says
**No register value is held.**

The dialog cannot be dismissed with Escape or a click outside. Tick **I switched automation off in
3.x** to enable **Continue**, or choose **Cancel** to stop. If you exported before step 1,
switch automation off in 3.x now (the saved values return to the inverter), then tick the box. No
second export is needed. Ticking the box restores nothing: it states that 3.x did.

#### Report lines

- **Partial days not imported**: a device span no tier covers whole days of, listed as
  `<device>: <start> to <end>`. Its bucket rows are skipped; raw readings in it are kept.
- **N lines dropped**: two archive lines at one device, metric and instant held different values. The
  first is kept; the first conflict is shown.

### 6. Check the result

Open the dashboard and the history for a day before the export.

## Retention

The import keeps each tier back to 4.0's retention, measured from the import:

| Tier | Kept |
| --- | --- |
| Raw | 7 days |
| Minute | 90 days |
| Hourly | 3650 days |
| Daily | Forever |

Raw and minute rows older than that are not stored but still roll into the hourly and daily
buckets. Hourly rows older than 3650 days are not imported; daily rows are always kept. The
retention pass runs at start and hourly, so an older row would be deleted anyway.

Override the defaults with the settings `retention.raw_days`, `retention.minute_days`,
`retention.hour_days` and `retention.day_days`. No web page or API sets them: they are rows in the
store's `setting` table, read at import and by the retention pass.

## Go back

4.0 wrote nothing to your inverter and nothing to 3.x. To return, stop 4.0, start 3.x and, if you want
automation back, turn the master switch on again.

Keep 3.x installed, its database and the archive until you are sure about 4.0. Delete them last.
