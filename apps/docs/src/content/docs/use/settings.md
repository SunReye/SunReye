---
title: Settings
description: Configure devices and integrations, the plant, tariff, prices, weather/forecast, profiles, access, and users from the UI.
---

The **Settings** screen (`/settings`) is where the deployment is configured at runtime —
most of it without touching `.env` or restarting. A live status poll keeps the connection
badges fresh.

The panels sit in a nav rail in three groups. Everything on this screen is **admin-only**:

| Group | Panels |
| --- | --- |
| **Connection** | [Devices](#devices), [Plant](#plant), [Sensors](#sensors) |
| **Preferences** | [Display](#display), [Tariff](#tariff), [Day-ahead prices](#day-ahead-prices), [Weather & Forecast](#weather--forecast) |
| **Admin** | [Access](#access), [Automations](#automations), [Profiles](#profiles), [Users](#users), [API Keys](#api-keys), [Logs](#logs), [Danger Zone](#danger-zone) |

<img class="sr-shot sr-light" src="/SunReye/screenshots/settings-light.png" alt="Settings → Devices: the plant's gateways with the devices reached through each." />
<img class="sr-shot sr-dark" src="/SunReye/screenshots/settings-dark.png" alt="Settings → Devices: the plant's gateways with the devices reached through each." />

:::note[Moved since 1.x]
The old **Inverter** tab held the connection *and* the plant's physical facts on one page, and
the old **MQTT & Home Assistant** tab held the broker. All three moved: the connection into
**Devices** (a gateway is one of several), the site facts into **Plant**, the roof and the pack
onto the inverter that has them, and the broker into a **connection** of its own with the
[integrations](#integrations) that ride on it listed underneath. `/settings/inverter` and
`/settings/integrations` both redirect to Devices, so old bookmarks and the setup wizard still
land.
:::

## Devices

One page for everything this plant talks to, grouped by the **connection** it is reached
through. A connection is an endpoint, not a protocol tab — it has a **kind**:

| Kind | What it is | What attaches to it |
| --- | --- | --- |
| **Modbus** | a gateway: transport (**Modbus TCP** or **RTU-over-TCP**), `host:port`, unit timeout and poll interval | devices addressed by unit id, each speaking a [profile](/profiles/concept/) |
| **MQTT** | a broker: URL, username, a write-only password, and an optional client id | [integrations](#integrations) — coded services, which may in turn provide devices of their own |

Each group's caption states the kind and endpoint; each device row under it shows the name,
role, address and profile, plus a badge when there is something to act on:

| Badge | Meaning |
| --- | --- |
| *(none)* | polling normally — the healthy row says nothing, so the pills that remain are the ones worth reading |
| **Not polled** | stored and addressable, but not being read; hover says why (see the release note below) |
| **via MQTT** | provided by an integration rather than polled — an EVCC loadpoint, say |
| **Internal** | a coded device SunReye provisions itself, such as the optimizer |
| **Retired** | out of service: no longer polled, history kept, restorable |

### Adding something

**Add device** opens a four-step wizard (`/settings/devices/add`) that asks one question per
step:

<img class="sr-shot sr-light" src="/SunReye/screenshots/add-wizard-light.png" alt="The Add wizard: four steps — Connection, What to attach, Settings, Confirm." />
<img class="sr-shot sr-dark" src="/SunReye/screenshots/add-wizard-dark.png" alt="The Add wizard: four steps — Connection, What to attach, Settings, Confirm." />

1. **Connection** — an endpoint that already exists, or *New connection…*, in which case the
   form for that kind (Modbus gateway or MQTT broker) is filled in here and created with it.
   You never have to save an endpoint first just to get to the thing you actually wanted.
2. **What to attach** — the server's **catalog**, keyed by the connection's kind: a *Modbus
   device* on a gateway; *EVCC* or *Home Assistant export* on a broker. A single-instance
   entry that the connection already has is shown and marked as taken rather than hidden, so
   it never looks like a missing feature.
3. **Settings** — the fields that entry actually needs. A Modbus device asks the device form:
   **role** (Inverter, Meter, Charger or Controller), **profile**, **unit id**, a **name**
   (the slug derived from it is previewed, and is what the API, MQTT topics and the source
   switcher use), and — for an inverter — the roof and the pack below. An integration asks
   only its own fields, named in your language, with defaults filled in.
4. **Confirm** — what will be created, in one list, before anything is written.

**Add connection** creates an endpoint on its own, for when you want the broker in place
before deciding what runs on it.

### Editing what is there

- **Test connection** — a port probe (*Reachable — port open, N ms*) and, with a profile
  picked, a live read that reports how many metrics came back and how long it took. Sanity-
  check the mapping before saving.
- **Edit device** — move it to another gateway, change its address, or swap its profile. The
  slug and all recorded history stay.
- **Edit connection** — change host, port, transport or interval for every device on that
  gateway at once (or the broker URL and credentials for every integration on it). A
  connection with nothing left on it can be deleted.
- **Retire / Restore** — a retired device leaves the roster and stops being polled; its
  readings stay and it can be restored later. Retired devices remain listed, because a device
  the UI cannot see is a device nobody can restore.

### What an inverter is made of

Only a device with **role = Inverter** carries the physical description, because one
plant-wide set could not say whose strings were whose once there were two. Its dialog gains:

- **PV arrays** — one row per orientation (**kWp**, **tilt**, **azimuth**; 0° = south,
  −90° = east, 90° = west). Add a row per string group facing a different way.
- **Temp. coefficient** and **System losses** — from the panel datasheet and the install.
- **Battery** — usable capacity, max charge power, reserve, and the pack's **nominal
  voltage**. The voltage is what peak shaving converts power into charge current with when
  the inverter reports no live battery voltage.

These feed more than the forecast: the battery drives [peak shaving](/use/automations/), and
the usable capacity is what [battery health](/use/statistics/) is measured against. The
forecast consumes them; it does not own them.

:::caution[One polled device for now]
This release polls a single device. The others are stored, addressable and restorable, but
not yet read — the panel says so on every row it isn't polling.
:::

### Integrations

An integration is a coded service that rides on a connection rather than a register map. They
are listed as rows under the connection they run on — because the connection is the thing that
fails, "what is configured on this plant" is answered in one place instead of on a tab per
protocol. Each row has a switch (enabled / disabled), **Edit** for its settings, and
**Remove**; devices an integration provides are nested under it.

| Integration | Runs on | Settings |
| --- | --- | --- |
| [Home Assistant export](/integrations/home-assistant/) | an MQTT broker | topic prefix, a **Home Assistant discovery** switch and its discovery prefix. One per broker. |
| [EVCC](/integrations/evcc/) | an MQTT broker | the EVCC **topic root** (default `evcc`). Each loadpoint it finds appears as a charger device, badged *via MQTT*. |
| SunReye Optimizer | nothing — it is internal | none. It provisions itself so [automation](/use/automations/) decisions are recorded like any other device's readings. |

Opening a row gives that integration **its own page**:

- **Status** — enabled or not, when it last connected, what has failed since, and a link to
  the connection it runs on. The state is *observed* from the connection's own client, not
  guessed from whether settings were saved.
- **Live readings** — what the integration itself reports for the whole plant (EVCC's total
  charge power, for instance), when it reports anything.
- **Devices it provides** — the rows it creates, with their slugs and indices.
- **Settings** — its own fields, saved live.

<img class="sr-shot sr-light" src="/SunReye/screenshots/integration-light.png" alt="An integration's own page: status, live readings, the devices it provides, and its settings." />
<img class="sr-shot sr-dark" src="/SunReye/screenshots/integration-dark.png" alt="An integration's own page: status, live readings, the devices it provides, and its settings." />

## Plant

What the **site** is, as opposed to any one box on it:

- **Maximum output / feed-in limit** — what the grid connection will take. Quick buttons set
  it to 60 / 70 / 100 % of the installed kWp summed across every in-service inverter.
- **House load** — the household's baseline draw (blank = inferred from history).
- **Smart meter gateway installed** — the date your iMSys went in, or blank if you don't have
  one. Installing it is what lifts the 60 % feed-in cap, and it marks the plant as one **§51
  EEG** applies to — so it is also the gate on price-aware charging.

The roof and the battery are *not* here; they describe an inverter and are edited on it under
[Devices](#devices).

## Sensors

**Sensor visibility**: hide sensors you don't use from this dashboard, grouped by role
(Solar, Battery, Grid, Load, Generator, Inverter). Hidden sensors are still recorded and still
published to [MQTT](/integrations/mqtt/) and the [API](/integrations/rest-api/) — they only
disappear from the web app.

## Display

Two halves, with different scopes — the panel says which is which:

- **Appearance** — colour theme (light / dark / system), interface **language**, and the
  **chart colours** the charts and the power-flow diagram are drawn in. This half applies to
  **your browser only**; changing the language reloads the page.

### Date & time

How timestamps render across the History charts and stepper: a **clock format**
(automatic/locale, 24-hour, or 12-hour) and a **time zone** (automatic, i.e. the viewer's, or
any IANA zone), with a **live preview** of "now". This half is **instance-wide** — it applies
to everyone using this instance.

:::note
The display time zone is a rendering choice only. Which day a reading is bucketed into is
decided by the *plant's* time zone, not by this setting.
:::
## Tariff

Configure pricing for the [Statistics](/use/statistics/) screen: currency, standing charge, feed-in
rate, a default import price, and **time-of-use bands** (name, price, hour range, weekday
selection). Add or remove bands and **Save tariff**.

**Investment** — what the plant cost all in and the day it went live. Both feed the
[Amortisation](/use/statistics/#amortisation) section; a total cost of 0 leaves it showing the
lifetime savings alone, and without a commissioning day the savings rate runs from the first
recorded day instead.

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

Turn on **Solar production forecast** and pick the irradiance **source**. What the forecast
needs to know about the plant itself is described elsewhere, because the automations and the
battery-health figure read the same values: the PV arrays, the loss coefficients and the
battery belong to the inverter that has them ([Devices](#devices)), while the feed-in limit
and the smart-meter date belong to the site ([Plant](#plant)). This tab keeps the location,
the switch and the source.

Those figures curtail the forecast so it doesn't overstate output once the battery is full and
export is capped. Past hours are reconstructed from the measured battery state at the start of
the day (falling back to the uncurtailed estimate when none is recorded), so the curve has no
artificial step at "now".

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

## Access

**Public read-only dashboard** — let anyone view the live dashboard without signing in, for
wall displays and kiosks. It is read-only: changing settings and controlling the inverter
still require an admin login. A link opens the public view so you can check what a stranger
sees. Off by default; see [Users & Roles](/use/users/) for what each role may do.

## Automations

The **master switch** that arms the automation engine — automations write inverter settings on
their own (today: the battery's max charge current). Turning it on requires accepting a
disclaimer once: the configured limits must match your hardware and grid contract, and you
remain responsible for the plant. SunReye restores your previous register value whenever an
automation lets go, and the panel records the day the disclaimer was accepted.

Each automation is configured on its own page — see [Automations](/use/automations/).
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

## Danger Zone

Destructive operations, each behind its own confirmation:

- **Export everything** — download the whole instance as one portable file: every reading, the
  plant and device setup, settings, profiles and custom charts, all named rather than numbered
  so a future SunReye can read it. This is the file to keep before a reset, and the way to move
  to another machine. Accounts and API keys are deliberately left out. A full history takes a
  minute or two and is tens of megabytes. See [Export & Import](/use/export-import/).
- **Reset all data** — permanently delete every recorded measurement, raw and rollups, so the
  instance starts fresh. Accounts, settings, tariff and profiles are kept. Requires typing the
  confirmation phrase, and cannot be undone. It also clears what the forecast's
  [learned correction](#learned-correction) has learned.
- **Restart the server** — apply boot-time changes, chiefly a newly activated inverter profile,
  which reshapes the API, manifest and topics that are built once at boot. Polling and live
  data pause briefly while it comes back.
