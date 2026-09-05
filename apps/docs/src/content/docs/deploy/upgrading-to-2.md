---
title: Upgrading to 2.0.0
description: What the 1.2.0 to 2.0.0 upgrade does to your database, what it asks you for, and why your history reappears in two stages.
---

SunReye 2.0.0 changes what a stored reading **is**. Until 2.0.0 a reading was identified by two
text columns — an `inverter_id` that actually held the *profile* id, plus a metric key. From 2.0.0
it is identified by a real device and a real metric, as two small integers keyed into `devices` and
`metric_keys` dimension tables.

That is not a change a continuous aggregate can survive, so the upgrade moves data. It is
**in place and automatic** — you do not export, reinstall or restore anything — but it happens in
two stages, and the second one is the reason your charts look short for a while.

## What happens on the update

### Stage 1 — the blocking step (under a second)

Runs inside the addon's boot chain, before the server starts. It touches the **catalog only**; it
moves no rows. Measured at **0.2 s** against a restored 60-day production-shaped fixture:

1. Every 1.2.0 retention, compression and refresh policy is removed. This is the decisive step,
   not tidy-up: the old minute tier's 90-day retention would otherwise keep deleting the oldest
   buckets while the upgrade waits for you.
2. `metrics_raw` is renamed to `metrics_raw_legacy`, and each old aggregate to a `legacy_` name.
   Every materialized bucket is kept and stays readable.
3. The 2.0.0 schema is created under the freed names — the dimension tables, the new `metrics_raw`,
   the configuration change-log, and one new generation of continuous aggregates.

When it finishes, nothing of the old schema is live, new readings land in the 2.0.0 shape
immediately, and the server answers `/healthz`. **Live data works from this moment on.**

### Stage 2 — the backfill (minutes to tens of minutes)

Your pre-upgrade history is still only in the renamed legacy objects. Replaying it forward is the
long part — **171 s for 5.7 million replayed rows** on a dev box, and materially slower on a Home
Assistant box with eMMC storage — so it runs **outside** the boot chain, where it cannot trip the
Supervisor's start-up timeout.

The backfill is **resumable**. It records its progress per chunk, in the same transaction that
writes the rows, so a restart, a power cut or a kill mid-run resumes where it stopped without
duplicating a row or leaving a gap. That is verified, including with an external `SIGKILL`.

You can **defer** it. Until it has run, history *before* the upgrade is absent from charts and
statistics — and SunReye says so rather than drawing a partial answer: a window that reaches back
past the migration horizon is refused with an explanation instead of silently reporting a smaller
number.

## What you are asked for, once

1.2.0 had no plants and no devices — it had a single inverter setting. 2.0.0 needs a **plant** and a
**device**, and the upgrade can create the rows but cannot invent the two names that become
permanent identifiers. So on first open after the update it asks for exactly two things, on one
form, and both are required:

- a name for your plant
- a name for the inverter (pre-filled from the active profile)

Until both exist, **Home Assistant MQTT discovery is held**. That is deliberate: a discovery
announcement is retained on the broker and keyed by its `unique_id`, so announcing under a
placeholder cannot be taken back by a later rename — the placeholder entities would stay and every
automation would point at the wrong half.

## What does not change

- **Your Home Assistant entity ids.** The MQTT `unique_id` scheme is unchanged in 2.0.0
  (`sunreye_<profile-id>_<metric>`), the topics are unchanged, and the HA device identifier is
  unchanged. Dashboards, automations, scripts and recorder history keep working untouched.
- **Every external contract still speaks names.** MQTT topics, `/api/v1/entities/:key`, the
  WebSocket metrics frame, `custom_charts.data` and `/api/history*` all still use metric keys. The
  integer identity is a storage detail, resolved at the database boundary.
- **Your settings, users, profiles and custom charts.** They live in tables that exist on both
  sides of the break and are carried across as they are.

## If it goes wrong

Take a backup before updating. The addon's own `dump.sh` writes one, and
`scripts/db-restore.sh` is the documented way back.

From 2.0.0 there is also a **schema-independent** route out: see
[Export & Import](/use/export-import/). An archive refers to devices by *slug* and metrics by
*key* and to no internal id at all, which is exactly why a future schema change will not need an
upgrade like this one. This upgrade is the last of its kind by design.
