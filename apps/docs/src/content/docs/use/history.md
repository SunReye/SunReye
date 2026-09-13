---
title: History & Analytics
description: Live and historical trends for every entity, backed by TimescaleDB rollups.
---

The **History** screen (`/history`) shows live and historical trends for *every* chartable
entity in one grid. It's backed by TimescaleDB: raw samples for recent windows, and
continuous-aggregate rollups (per-minute / hourly / daily) for longer spans, so multi-week
charts stay fast.

<img class="sr-shot sr-light" src="/SunReye/screenshots/history-light.png" alt="The History grid: every entity charted, grouped by category, with a date-range picker." />
<img class="sr-shot sr-dark" src="/SunReye/screenshots/history-dark.png" alt="The History grid: every entity charted, grouped by category, with a date-range picker." />

## Layout

- A **range navigator** at the top controls the window for every chart at once.
- A **search box** filters entities by label or key.
- Entities are grouped into collapsible **categories** — Solar, Battery, Grid, Backup/Load,
  Inverter, System and the rest — derived from each metric's role, with a count per group. The
  grid is responsive (1–3 columns).
- Only "chartable" metrics (measurements and cumulative counters) appear.
- On a plant with more than one source, the sidebar's
  [source switcher](/use/dashboard/#source-switcher) decides whose metrics are charted — the
  plant as a whole, or one device. The choice is the app's, not this page's: it follows you to
  Statistics and the Overview.

## Range navigator

One control, two rows, shared with the [Statistics](/use/statistics/) page:

```
┌──────────────────────────────────────┐
│  Day  │  Week  │  Month  │  Year     │
├──────────────────────────────────────┤
│   ‹   📅 Today  ● Live      › (off)  │
└──────────────────────────────────────┘
```

- The **grain tabs** pick a calendar period. Every boundary is resolved from date parts in an
  explicit time zone, so a day across a DST change is 23 or 25 hours, not "24 × 3600 s".
- The **arrows** step one period at a time; the title in between names where you are — *Today*,
  *Yesterday*, a date, a week, a month — in the
  [configured time zone](/use/settings/#date--time).
- There is **no Live tab**: standing on the current period *is* live, which the title's
  **Live** pill says and the **disabled forward arrow** confirms. Stepping forward back onto
  today returns you to it.
- The **calendar button** opens a date picker for an arbitrary range, and keeps the handful of
  spans a calendar cannot express — 1 hour, 6 hours, 14 days, 6 months. While one of those is
  showing, no grain tab is lit and the title prints the span instead.

Today's tab shows the **elapsed day** from stored history, not just the few minutes the live
buffer holds — so opening History at 18:00 draws the day from midnight.

The rollup bucket is chosen automatically from the span: per-minute resolution up to and
including a week, hourly for anything longer.

## Entity cards

Each metric gets a card showing its title and live current value. Cards **lazy-mount as you
scroll**, so a big grid stays light.

- In the **Live** range, the card draws a continuously gliding sparkline from the in-memory
  buffer.
- For any historical range, it fetches rollups and draws an area chart with a smooth curve,
  axes, gridlines, and a formatted tooltip.
- **Signed** metrics (those with a flow direction, like battery or grid power) use a
  red/green diverging gradient split at zero.
- **Compare with…** overlays up to eight other metrics on this card without saving anything —
  it is a read, so it is not admin-gated. Save the result and it becomes a
  [custom chart](#custom-charts) through the ordinary editor, which is.
- **Full screen** expands one card to the whole viewport; a card expanded before it scrolled
  into view mounts its chart anyway rather than staying a skeleton.

## Custom charts

Above the per-entity grid is a **Custom charts** section where you overlay several metrics on
one chart — e.g. all PV strings, or battery vs. grid power together.

- **New chart** (admin only) opens an editor: name it and tick **up to 8 metrics** from the
  same category-grouped, searchable list the grid uses. Edit or delete a chart from its card.
- Charts follow the page's **date range** (including the day stepper and Live), so all of
  them move together with the entity grid.
- An **Area / Line** toggle switches the render style for every custom chart at once. It's a
  view-only choice — not saved per chart.
- Saved charts are stored server-side and shared across the instance. Non-admins **see** the
  charts but can't create or edit them; the section is hidden entirely for non-admins when
  none exist yet.

## Retention

Raw readings are kept for **five years**, the minute rollups for 90 days, the hourly rollups
for ten years, and the daily rollups forever; older telemetry is compressed automatically and
aged out by retention jobs. The minute tier's 90 days is a *resolution* window rather than a
coverage horizon — past it, a minute-resolution read falls back to raw and a wider read to the
hourly tier, so nothing disappears from a chart. Long ranges draw from rollups rather than raw
rows because a rollup bucket is a few bytes and a five-year raw scan is not.

Every interval is tunable in `packages/db/src/timescale/policies.sql`, which is re-applied on
every migration run.
