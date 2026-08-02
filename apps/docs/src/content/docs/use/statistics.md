---
title: Statistics
description: Cost, energy, spot price and record analytics over the telemetry SunReye already stores.
---

The **Statistics** screen (`/statistics`) is the page prosumers open daily: what the period
cost, where the energy went, what the market did, and how all of it compares to the period
before. It is analysis over telemetry SunReye already stores — no extra polling — priced with
the tariff you configure in [Settings → Tariff](/use/settings/).

This screen used to be **Costs & Tariffs** at `/costs`. That URL redirects here, and old
`#/costs` bookmarks land on this page.

<!--
SCREENSHOTS PENDING RETAKE — do not reuse the old ones.
The page was rebuilt (four sections, per-chart scope switchers, customize mode), so
`public/screenshots/costs-light.png` and `costs-dark.png` no longer show this screen and are
deliberately not embedded here. Retake both light and dark against a system that has a spot
price feed and a battery, save them as `statistics-light.png` / `statistics-dark.png`, embed
them below this comment with the existing `sr-shot sr-light` / `sr-dark` classes, and delete
the two stale `costs-*.png` files.
-->

## Range picker and view scopes

One range picker at the top drives the whole page: **Today**, **Last 7 days**, **This
month**, **Last month**, **This year**, or a custom from/to. Two things sit outside it on
purpose — today's and tomorrow's day-ahead curves (forward-looking) and the all-time records
(rangeless).

Charts additionally carry a **view scope** toggle in their section header:

- **Detail** — buckets *inside* the picked window (today → by hour, a week or a month → by
  day, a year → by month).
- **Context** — zooms one level out, so the window sits in its surroundings (this month → the
  trailing 12 months, this year → the trailing 24).

The toggle is available to every viewer and is not saved; only its starting position comes
from the instance preferences. Switching it refetches that section's series only.

## Sections

Each of the four sections is a collapsible card: an uppercase title, the range it is showing,
and a caret to fold it away. A collapsed section unmounts its contents, so it costs no
requests.

### Cost & savings

Nine tiles, each with a headline figure and a sub-line:

| Tile | Meaning |
| --- | --- |
| **Grid cost** | Import cost plus the standing charge. |
| **Exported for nothing** | §51 only — see [below](#export-that-earned-nothing-51). |
| **Net cost** | The bill after export earnings (a credit when negative, shown in green). |
| **Grid import** | Cost and kWh drawn from the grid. |
| **Export earnings** | Earnings and kWh fed in. |
| **Solar saving** | The kWh solar and the battery served instead of the grid (load − import), at the effective grid price they displaced. |
| **Total savings** | Solar saving plus export earnings, versus buying everything from the grid. |
| **Self-sufficiency** | % of load met by solar/battery. |
| **Self-consumption** | % of production used on-site. |

Below them, **net cost per period** as bars (credit periods in green), and **import by tariff
band** — kWh and cost per time-of-use band, when bands are configured.

### Energy analytics

A totals row first, because "how much did we produce last month?" should not require reading
a chart: **produced**, **consumed**, **self-used**, and — on a system with a battery —
**charged** and **discharged**. Each carries an average-per-day sub-line and a delta chip
against the reference window (see [Comparisons & records](#comparisons--records)).

**Self-used** is production the plant kept — production minus export — the same measure the
self-consumption percentage reports. That is a different figure from the *Solar saving* tile
above, which values what was not bought (load minus import); on a battery system the two
differ, because energy discharged today may have been stored yesterday.

Then three charts over one shared series, all moved by the section's scope toggle:

- **Energy flows** — import, export, load and production, plus the battery pair when there is
  one.
- **Consumption / production split** — from grid vs. from solar/battery, and used on-site vs.
  exported, with a kWh / % share toggle.
- **Ratios** — self-sufficiency and self-consumption as trend lines.

Last, the **hour × weekday heatmap**: the picked window folded onto one week, 24 hours × 7
days. Every cell is an *average* — the window's total for that slot divided by how often the
slot occurred — so a 3-day and a 90-day window read the same way. A switcher picks the metric
(consumption, import, export, production) with no refetch, since the server ships all four
figures on every cell.

### Spot price analytics

Only exists when a [price source](/use/settings/) is configured. Without one the section is
not rendered at all, and does not appear in customize mode either.

Market tiles for the picked window — average, minimum and maximum price in ct/kWh, negative
hours, and **your import price**: the price-weighted average of the hours this house actually
imported in, read against the same market average the tile beside it states. Below that
average means it bought in the cheaper hours.

Then the day-ahead curves, in a fixed order: **today** first, with a now-marker, and
**tomorrow** directly below it. Before the auction clears (~13:00 market time) tomorrow's slot
carries a "not published yet" note rather than an empty chart — an empty list then means
*unknown*, not "no negative prices". With an hourly price source the notes say so, because a
negative quarter-hour inside a net-positive hour cannot be resolved from hourly data. The
source's attribution line sits with the curves.

Below the curves, the **negative-price window history** for the analysis period, grouped per
day and split at midnight, since "tonight" and "tomorrow morning" are separate things to act
on. When the raw scan could not reach the start of the period, the list says so.

Finally the **what-if** row, when the window holds market prices to reprice against: the same
imported energy costed on a static tariff and on spot, and the difference between them. The
caption states how much of the window had a market price, and admits when no spot components
(markup, grid fees, levies) are configured — bare wholesale is not a quote.

### Comparisons & records

Every window is shown against a reference window, picked with a toggle: **the previous *n*
days** (an adjacent window of the same length) or **the same window a year ago**. The
comparison tiles restate net cost, savings and import with a signed delta chip — green when
the movement is in the household's favour, an em dash when the reference window predates
recorded history, so a first-month household never reads a fake −100 %.

Under them, **all-time records** per day: the biggest production, export, load and import
day, the best and worst self-sufficiency day, and the cheapest, most expensive and
best-earning day. Energy records reach back over the whole daily history; the money records
only cover the horizon the server can still price, and are omitted outside it.

Last, **this year against last**, month by month, for net cost or production.

## Live updates

While the picked range includes *now*, the page holds a websocket lease on `/ws/statistics`
and the server pushes today's figures every 15 seconds:

- On the **Today** preset the pushed breakdown *is* the picked window, so the tiles update
  straight from the stream with no refetch.
- On a wider now-inclusive range the push is only an invalidation signal, and the window is
  refetched at most once a minute.
- A completed spot-price sync refreshes everything price-derived.

A past-only range (last month, a historical custom range) takes no lease at all, which leaves
the server with no subscribers and skips the job entirely.

The inverter's own day counters run slightly ahead of the hourly rollups, so any window that
runs up to now — today, this month, this year — reports the in-progress day's **energy** from
those counters, swapping out only today's share of the total. This month therefore always
covers the day inside it. Money is the exception: it stays priced hour by hour from the
rollups, since a whole-day counter can't be split across your tariff's time bands. While the
day is young the two can differ by a few cents.

## Gaps in the record

Every figure on this page is derived from the rise of the inverter's lifetime counters between
two recorded readings. If the server was down, the counters kept climbing, and the first
reading after it comes back is higher by everything that happened in between — with nothing to
say *when* any of it happened.

Energy across a hole longer than a few hours is therefore left out rather than dumped into the
hour the server came back: a three-day outage would otherwise bill Monday's kWh to Thursday
lunchtime, and land it in whichever window and tariff band that hour falls in. Short holes — a
restart, a handful of missed polls — are still bridged, since misplacing an hour inside its own
day changes nothing you can read. So a window containing downtime reports slightly less energy
and cost than the meter did, and the tiles say so consistently across every section.

## Customize mode (admins)

Admins get a sliders button beside the range picker. It opens a **draft**: the sections gain a
dashed outline, each section header an eye toggle (hide it) and a "starts collapsed"
checkbox, and each tile a checkbox. Hidden items stay visible but dimmed while editing, so
they can be switched back on. Nothing reaches the server until **Save**; **Cancel** drops the
draft.

The layout is **instance-wide**, not per-user: it is the curated page every viewer gets.
Non-admins see no button and cannot change it — but the ephemeral controls (view scope,
heatmap metric, comparison mode, kWh / % share) stay available to everyone, starting from the
saved defaults.

## What a system without a given capability sees

Nothing on this page renders an empty shell. What is available is decided by the system's
configuration and data, independently of the customize preferences — hiding is a preference,
gating is a capability:

- **No spot price feed** — no spot price analytics section anywhere, including customize
  mode.
- **A static export tariff** — no §51 anywhere: the "Exported for nothing" tile appears only
  once there is zero-value export to report.
- **No battery** — no battery tiles, and no battery lines in the energy charts.
- **No tariff bands configured** — no band breakdown.
- **No data in the window** — its charts are omitted; the tiles still state the zeroes
  honestly.

## Export that earned nothing (§51)

With the export marketing model set to **§51** (Settings → Tariff), the cost tiles gain
**Exported for nothing**: the kWh sent to the grid during negative quarter-hours, and the
feed-in revenue that forwent. Under §51 a plant commissioned after 2025-02-25 receives no
feed-in payment for a quarter-hour whose price was negative, so those windows are the hours
worth planning around: energy exported then earns nothing, while energy stored or consumed
keeps its full value.

The figure is exact to the hour and prorated within it — export counters are read hourly, so
an hour with two negative quarter-hours has half its export priced at zero. Export within a
sunny hour is smooth, so the approximation is small against the number it produces.

Month-bucketed views are the exception: grouping by hour-of-day and weekday cannot
distinguish 14:00 on the 3rd from 14:00 on the 17th, so a month-bucketed cost series is
computed per day and rolled up instead.

## Configuring the tariff

Set currency, standing charge, feed-in rate, a default import price, and time-of-use import
bands (each with a price, hour range, and weekday selection) in
[Settings → Tariff](/use/settings/). Everything on this screen updates from that model.
