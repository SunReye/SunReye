---
title: Settings
description: Configure the inverter connection, MQTT, tariff, weather/forecast, profiles, and users from the UI.
---

The **Settings** screen (`/settings`) is where the deployment is configured at runtime —
most of it without touching `.env` or restarting. The whole screen is **admin-only**. A
live status poll keeps the connection badges fresh.

Tabs: **Inverter**, **MQTT & Home Assistant**, **Tariff**, **Weather & Forecast**, **Date &
Time** (any admin), plus **Profiles**, **Users**, **API Keys**, and **Logs** (admin).

<img class="sr-shot sr-light" src="/SunReye/screenshots/settings-light.png" alt="Settings → Inverter: Modbus connection fields with a live status badge and Test connection." />
<img class="sr-shot sr-dark" src="/SunReye/screenshots/settings-dark.png" alt="Settings → Inverter: Modbus connection fields with a live status badge and Test connection." />

## Inverter

Configure the **Modbus connection**: host, port, transport (**Modbus TCP** or
**RTU-over-TCP**), unit id, timeout, and poll interval. A status badge shows Connected /
Disconnected / Simulated.

- **Test connection** captures a live snapshot and opens a table (metric / group / value)
  so you can sanity-check the mapping before saving.
- **Save** applies the change live — no restart.
- The **active profile** is shown here read-only; changing it lives on the
  [Profiles](#profiles) tab and takes effect on restart.
- If simulation mode is on (`INVERTER_SIMULATE`), a notice explains the settings are saved
  but unused.

## MQTT & Home Assistant

Configure the [MQTT bridge](/integrations/mqtt/): enable switch, broker URL, topic prefix,
username, and a write-only password field. A **Home Assistant discovery** switch reveals the
discovery prefix. A status badge shows Disabled / Connecting… / Connected, with a **Test
connection** button. Saving applies live.

## Tariff

Configure pricing for the [Statistics](/use/statistics/) screen: currency, standing charge, feed-in
rate, a default import price, and **time-of-use bands** (name, price, hour range, weekday
selection). Add or remove bands and **Save tariff**.

**Market-linked prices** is the half that needs a [price source](#day-ahead-prices):

- **Export remuneration** — a fixed feed-in tariff (the default, market ignored); *§51*, where a
  quarter-hour with a negative day-ahead price pays nothing; or *direct marketing*, where you are
  paid the market price less a management fee. The difference matters: under §51 exporting into a
  negative slot is **worthless but not costly**, so there is nothing to gain by curtailing — only
  by storing or consuming the energy instead. Under direct marketing a negative slot actually
  costs you money.
- **Import price follows the market** — only for a spot-linked contract (Tibber, aWATTar,
  Ostrom …). The landed price is the wholesale price plus supplier markup, grid fees and levies,
  then VAT on the whole sum — including a negative wholesale part, as on a real invoice. Leave
  this off for a fixed or time-of-use price; the bands above are then used, and are also the
  fallback for any slot whose market price is unknown.

## Day-ahead prices

Optionally fetch **day-ahead wholesale electricity prices** for your bidding zone. Pick a
**price source** and a **zone** (default `DE-LU`) and save; prices for today and tomorrow
are stored and refreshed in the background.

Why this is its own setting rather than part of the tariff: the price *feed* is useful even
on a fixed bill. Under **§51 EEG** a plant commissioned after 2025-02-25 is paid **nothing**
for energy exported during a quarter-hour whose day-ahead price was negative — so knowing
which slots those are matters regardless of what you pay for import.

- **Source** — `energy-charts` (Fraunhofer ISE) by default: keyless and, importantly, it
  serves true **quarter-hour** prices. `awattar` is also available (DE/AT, keyless) for
  aWATTar/tado customers who want their own supplier's curve — but it publishes hourly prices
  only, so it cannot resolve the negative quarter-hours §51 turns on. Since 2025-10-01 the German day-ahead market trades
  15-minute products, and an hourly average hides a negative quarter-hour sitting inside a
  net-positive hour — exactly the case §51 turns on. Where a source only publishes hourly
  data, SunReye says so rather than implying precision it doesn't have.
- **Zone** — the market area you settle in. The delivery day is measured in the *market's*
  time zone, so day boundaries stay correct wherever the server runs.

Tomorrow's prices clear around 13:00 market time. Until then only today is available, and
the UI distinguishes "no negative slots" from "tomorrow not published yet" — an absent slot
means *unknown*, never a price of zero.

Price data from the default source is republished from Bundesnetzagentur / SMARD.de under
CC BY 4.0; SunReye shows the required credit alongside the prices.

## Weather & Forecast

Show current weather on the dashboard and, optionally, a **PV production forecast** — both
from [Open-Meteo](https://open-meteo.com/) (keyless, server-proxied). Set the plant
**location** (latitude / longitude + a display name) to enable the weather tile.

Turn on **Solar production forecast** and describe the plant so SunReye can turn the
irradiance forecast into expected output:

- **PV arrays** — one row per orientation (**kWp**, **tilt**, **azimuth**; 0° = south,
  −90° = east, 90° = west). Add a row per string group facing a different way.
- **Temp. coefficient** and **System losses** — from the panel datasheet and install.
- **Smart meter gateway installed** — the date your iMSys went in, or blank if you don't have
  one. Installing it is what lifts the 60 % feed-in cap, and it marks the plant as one **§51
  EEG** applies to — so it is also the gate on price-aware charging. Quick buttons set the
  feed-in limit to 60 / 70 / 100 % of installed kWp. Raising the cap leaves ordinary peak
  shaving with much less to do, which is exactly what price-aware charging is for.
- **Clipping** — feed-in limit, usable battery, max charge power, and reserve, plus an
  average **house load** (blank = inferred from history). These curtail the forecast so it
  doesn't overstate output once the battery is full and export is capped. Past hours are
  reconstructed from the measured battery state at the start of the day (falling back to
  the uncurtailed estimate when none is recorded), so the curve has no artificial step at
  "now".

The forecast is also published to [MQTT / Home Assistant](/integrations/mqtt/) and the
[REST API](/integrations/rest-api/), not just the dashboard tile.

### Learned correction

**Apply learned correction** enables *site adaptation*: SunReye runs reanalysis weather
through the same PV model to get the output your plant *should* have made, compares it against
your measured production, and learns a per-**month × hour** multiplier for the plant's
systematic bias — horizon shading, soiling, snow, degradation, or an over-pessimistic
system-loss figure. It corrects that repeatable error; it can't fix day-ahead cloud misses,
which are irreducible.

- Learning runs **in the background** whenever the forecast is configured. The toggle only
  controls whether the learned factor is **applied**, so you can inspect it first.
- The panel shows the measured **error reduction**, sample count, last-learned day, and a
  heatmap of the applied factors (amber = trimmed below the model, green = boosted above it).
- Factors fill in over the first weeks — it needs a little production history plus settled
  reanalysis (a few days' lag). Clearing time-series data (Danger Zone) also resets what has
  been learned.
- Hours near the plant's limits — very dim ones, and ones at the feed-in limit or close to
  nameplate — are excluded from learning, so curtailment (full battery, capped export) isn't
  mistaken for model bias.

## Date & Time

How timestamps render across the History charts and stepper. Two controls — a **clock
format** (automatic/locale, 24-hour, or 12-hour) and a **time zone** (automatic, i.e. the
viewer's, or any IANA zone) — with a **live preview** of "now". The setting is
**instance-wide**: it applies to everyone using this instance, and only admins can change it.

## Profiles

Manage inverter [profiles](/profiles/concept/) (admin only), in three sections:

- **Installed profiles** — set active or remove, with built-in vs downloaded and version
  shown. A **Restart required** banner appears after activating or installing.
- **Profile repositories** — add/remove/enable git repo sources. Sources **auto-save** as you
  edit, with optimistic updates.
- **Available profiles** — **Browse** enabled repos. Profiles are grouped by **manufacturer**
  and, within that, by **family** (collapsible), and each row shows its **source repo**. Per
  profile: Download, or Update when the repo offers a semver-newer release.

At the top, an **updates banner** surfaces installed profiles with a newer version waiting —
each with a one-click *Update to vX*. A [background checker](/profiles/distribution/#update-checking)
refreshes this every few hours, so you see updates without browsing.

See [Distributing Profiles](/profiles/distribution/) for the full flow.

## Users

Manage accounts (admin only): add a user (name, email, password, role) and edit or delete
users in a table, including changing roles inline. See [Users & Roles](/use/users/).

## API Keys

Issue and revoke API keys for the [REST API](/integrations/rest-api/) (admin only):

- **Issue key** — pick the owning user, name the key, and optionally set an expiry
  (30 days / 90 days / 1 year / never). On create, the full key is shown **once** in a
  dialog with a copy button — store it then, as only a short prefix is kept afterwards.
- **Keys table** — filter by user; each row shows name, owner, prefix, created/expiry dates.
  **Revoke** deletes a key immediately; requests using it then return `401`.

Keys are stored hashed and work alongside the static `API_KEYS`
[environment variable](/reference/environment/). See
[REST API → Authentication](/integrations/rest-api/#authentication) for how they're presented
on requests.

## Logs

A live view of the server log stream (`/settings/logs`, admin only), streamed over a WebSocket:

- **Live feed** — auto-follows the tail; scroll up to pause following, **Pause**/**Resume** to
  freeze the view while lines keep arriving (the resume button shows how many are waiting).
  **Export** saves the current view as a `.txt` file; **Clear** empties the panel.
- **View filters** — the **level** and **source** dropdowns narrow what the panel renders (and
  what Export saves). They are client-side only; the server keeps emitting everything. Sources are
  the log categories in view (e.g. `server.mqtt`, `server.http`, `inverter-core.driver`).
- **Server level** — sets the lowest severity the *server itself* emits, persisted and applied
  immediately (no restart). **Default** follows the [`LOG_LEVEL`](/reference/environment/) boot
  value; the MQTT transport can be pinned separately with `LOG_LEVEL_MQTT`. Raising this to
  `debug` surfaces per-poll Modbus read timing and other detail; lower it back to keep logs quiet.

:::note
Client-side admin gating is UX only — every mutation is enforced on the server.
:::

## Automations

Peak shaving is configured under Settings → Automations (master switch) and on the automation's
own page. Alongside its two modes it has a **negative-price windows** section:

- **Act on negative prices** — off by default, and locked until a smart meter gateway install
  date is set. With it on, the battery makes room ahead of a window with a negative day-ahead
  price and absorbs the surplus during it. Energy exported in those quarter-hours earns nothing
  under §51 EEG, so storing it is the only way to keep its value.
- **Hold the battery low before a window** — charges as much as possible, as late as possible,
  rather than simply stopping: pre-window PV *is* paid for, and the reserve floor still applies.
- **Use the car as a sink** — borrows connected [EVCC](/integrations/evcc/) chargers for a window.
  Off by default, and it works in two steps. An idle charger is woken onto **surplus charging**, so
  it eats what would otherwise be exported for nothing. And while the battery is still too full to
  make room on its own, SunReye switches on EVCC's **battery boost**, which drains the house battery
  into the car — the only sink big enough, since a house alone cannot absorb enough in the hours
  before a window. Boost stops at the **battery boost floor** below, and is switched off again once
  the window starts: from then on the battery should be *filling* with energy that earns nothing.
  A charger you left on immediate charging is never touched, and everything borrowed is remembered
  on disk, so a restart mid-window still hands the car back.
- **Battery boost floor** — how far the car may empty the house battery while boosting. EVCC holds
  the battery there rather than letting it oscillate, and the plant's own reserve applies on top, so
  this can only ever ask for *less* discharge than the inverter already allows.
- **Charge the battery from the grid** — buys from the grid during a window. Off by default and
  inert unless your **import** price follows the market (Settings → Tariff): a negative wholesale
  price does not lower a fixed bill. Even on a spot tariff you still pay grid fees, levies and
  VAT, so this is about buying at the cheapest hour of the day, not about being paid to consume.
  Needs an inverter that exposes the grid-charge registers; where it doesn't, the switch simply
  has no effect.
- Thresholds for what counts as negative, the shortest window worth acting on, how far ahead to
  plan, how much feed-in to allow during a window, the grid-charge current, and a reserve margin.

Note that negative prices are usually driven by **wind**, and the deepest ones fall at night. The
loop normally parks itself when there is no sun and none coming; with price awareness on, a live
negative window keeps it awake — otherwise the one case grid-charging exists for could never
fire.

The status panel names what it is doing (*making room*, *absorbing*, *too full*) and reports the
window, the SOC ceiling in force, how much the window can absorb — and how much **cannot be
rescued**. That last figure matters: withholding charge often cannot empty a pack in time, and
shifting flexible load into the window is what closes the gap.
