---
title: Costs & Tariffs
description: Price your energy flows — import/export tariffs, savings, and self-sufficiency.
---

The **Costs** screen (`/costs`) turns energy flows into money using the tariff you configure
in [Settings → Tariff](/use/settings/). It's analysis over telemetry SunReye already stores
— no extra polling.

<img class="sr-shot sr-light" src="/SunReye/screenshots/costs-light.png" alt="The Costs screen: net cost, import/export, savings, and self-sufficiency tiles above a 12-month energy split." />
<img class="sr-shot sr-dark" src="/SunReye/screenshots/costs-dark.png" alt="The Costs screen: net cost, import/export, savings, and self-sufficiency tiles above a 12-month energy split." />

## Range and headline tiles

A range switcher (**Today / This month / This year**) drives six headline tiles, formatted
in your tariff currency:

| Tile | Meaning |
| --- | --- |
| **Net cost** | Total bill including the standing charge (shown as a credit when negative). |
| **Grid import** | Cost and kWh drawn from the grid. |
| **Export earnings** | Earnings and kWh exported (feed-in). |
| **Savings vs grid-only** | What you saved versus buying everything from the grid. |
| **Self-sufficiency** | % of your load met by solar/battery. |
| **Self-consumption** | % of your production used on-site. |

## 12-month energy split

An independent 12-month view (not tied to the range switcher) with a **kWh / % share**
toggle and two charts:

- **Consumption** — from grid vs from solar/battery, captioned with average
  self-sufficiency.
- **Production** — used on-site vs exported, captioned with average self-consumption.

## Detail

- **Net cost per day** — a horizontal bar per day (green bars for credit days).
- **Import by tariff band** — kWh and cost per time-of-use band, when bands are configured.

## Day-ahead prices

When a [price source](/use/settings/) is configured, the bottom of the screen shows the
wholesale day-ahead price for today and tomorrow in ct/kWh, and — the reason the panel
exists — lists the **negative-price windows**. Under §51 EEG a plant commissioned after
2025-02-25 receives no feed-in payment for a quarter-hour whose price was negative, so those
windows are the hours worth planning around: energy exported then earns nothing, while energy
stored or consumed keeps its full value.

Windows are grouped per day and split at midnight, since "tonight" and "tomorrow morning" are
separate things to act on. Two things the panel deliberately will *not* claim:

- Before tomorrow's auction clears (~13:00 market time) it does not say "no negative prices" —
  an empty list then means *unknown*.
- With an hourly price source it says so, because a negative quarter-hour inside a
  net-positive hour cannot be resolved from hourly data.

This panel is forward-looking and independent of the range picker above it. Historical costing
still prices export at the configured flat feed-in rate.

## Configuring the tariff

Set currency, standing charge, feed-in rate, a default import price, and time-of-use import
bands (each with a price, hour range, and weekday selection) in
[Settings → Tariff](/use/settings/). Everything on this screen updates from that model.
