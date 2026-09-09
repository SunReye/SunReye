---
title: Export & Import
description: Take your whole instance out as one portable file — every reading, the plant setup, your settings — and read it back into another SunReye.
---

SunReye can write its entire contents to **one portable file** and read that file back. It is
the way to move to another machine, the thing to keep before a reset, and the reason a future
schema change cannot cost you your history.

## Why not just back up the database?

A `pg_dump` is an excellent **backup** of one version and a poor **migration vehicle**. It
carries the schema with it: column names, the continuous-aggregate definitions, the internal
integer ids. Restore it into a newer SunReye whose storage layout has changed and it does not
fit.

That is not a theoretical concern — it is the reason SunReye 2.0.0 resets the database once,
by hand, instead of migrating. This format exists so that never has to happen again.

The archive is therefore **named, not numbered**. Every reading says which device it came from
by that device's *slug* and which measurement it is by that metric's *key* — the same names the
REST API, the MQTT topics and the Home Assistant entities already use. Nothing in the file
refers to an internal id, so a future SunReye can read it whatever it does internally.

## What is in the file

A gzipped tar with four members:

| Member                 | Holds                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| `manifest.json`        | format version, the schema it came from, the time zone, row counts    |
| `config.json`          | the plant, connections and devices; settings; profiles; custom charts |
| `config-log.ndjson.gz` | the history of configuration-register changes                          |
| `readings.ndjson.gz`   | every reading, one JSON object per line                                |

A reading line looks like this, and this shape is the compatibility promise:

```json
{"time":"2026-07-28T12:34:00.000Z","device_slug":"deye-1","metric_key":"total_energy","value":41.97,"dur_ms":60000,"source_tier":"minute"}
```

`source_tier` is `raw`, `minute`, `hourly` or `daily` — where the value came from. A `raw` row
is a poll; the others are aggregate buckets, and `dur_ms` is how long the value stood. Keeping
that distinction is what lets one file hold fine-grained recent history *and* coarser older
history, which is exactly what an instance whose fine-grained retention has expired has.

### What is deliberately NOT in the file

**No accounts, no sessions, no API keys.** Password hashes and live session tokens in a file
designed to be copied onto a USB stick and emailed are a liability, and recreating the admin
account is a 30-second onboarding step. This is a decision, not an oversight.

**No secrets, by default.** Your MQTT password and any provider token are stored in
plaintext, and SunReye's own REST API refuses to return them even to a logged-in admin — so an
export replaces them with `__redacted__`. On the Home Assistant add-on the export lands in
`/share`, which the Samba add-on serves to your whole network, so this matters.

When you are genuinely **moving machines** and want them carried, pass `--include-secrets`,
and treat the resulting file as a credential:

```bash
sunreye export --include-secrets --out /share/migration.tar.gz
```

The redacted fields are left present rather than removed, so after a normal import you can see
exactly which ones to retype instead of wondering whether one was ever set.

## Exporting

From the UI: **Settings → Danger Zone → Download export**. The file streams straight to your
browser's downloads folder. A full history takes a minute or two and is tens of megabytes.

From the command line, which is also the path that works when the server will not start:

```bash
sunreye export --out /share/my-export.tar.gz
```

On the Home Assistant add-on, `/share` is visible to the Samba and File Editor add-ons, so
writing the export there is how you get it off the box.

## Importing

**Import into an empty database.** This is the one rule that matters.

```bash
sunreye import /share/my-export.tar.gz
```

The import applies `config.json` first (so the devices and metrics every reading names exist),
inserts the readings, and then **refreshes the aggregates over the whole imported span** — the
last step matters, because SunReye's normal background refresh only ever looks at the last few
hours and would never reach imported history. Skip it (`--no-refresh`) and you get a full
database with empty charts.

Useful options:

| Option                     | Does                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `--device-map old=new`     | rename a device on the way in — how one imported device becomes several |
| `--no-config`              | import readings only; leave settings, profiles and charts alone   |
| `--no-refresh`             | skip the aggregate refresh (charts stay empty until you run one)  |
| `--force`                  | proceed even though the target already holds rows in this span    |

### Importing twice

Re-importing **the same file** is a no-op: SunReye records that the archive was imported in
full and does nothing the second time.

Importing over history the target **already holds** is refused, and it is worth knowing why.
There is no unique key on the readings table — there cannot be one without slowing down the
1 Hz write path — so a second import of overlapping history would *duplicate* rather than
replace it. A duplicated series does not raise an error anywhere; it just quietly reports the
wrong kWh. So SunReye refuses and tells you how many rows are in the way. `--force` is there
if you have decided the duplicates are acceptable.

An import that was **interrupted** is also refused rather than resumed, for the same reason:
half of it can be safely redone and half cannot, and guessing which is not worth the risk to
your history. Reset the time-series and import again.

### Importing history older than your retention

Readings older than the retention window are imported successfully — and then **deleted by the
next scheduled retention job**. Retention is not checked when rows are inserted, so nothing
else would ever tell you. The import prints a warning naming the oldest reading and the
retention interval; if you want to keep those rows, raise the retention interval before the
next job runs.

## Counters that reset

Inverters reset their energy counters — daily registers at midnight, and lifetime totals
occasionally after a firmware update or a power cut. The archive preserves the information
needed to account for that correctly.

This is not a nicety. On SunReye's own test fixture, a day whose lifetime counter resets
mid-afternoon really produced **41.97 kWh**; reading the same day as "highest value minus
lowest value" gives **64,280.97 kWh** — wrong by a factor of 1532. A round trip through the
archive reports 41.97.
