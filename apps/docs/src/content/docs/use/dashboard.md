---
title: Dashboard
description: The live overview — a power-flow hero, today's energy and money, weather, and the car, all rendered from the profile.
---

The **Overview** (`/`) is the live home screen, built to be readable across a room: on a
tablet, desktop or wall display it pins to the viewport and never scrolls. Everything on it
renders from the active device's
[capabilities](/profiles/concept/#from-roles-to-capabilities) — nothing is hard-coded per
vendor, so a node or a card appears only for a subsystem your inverter actually has. Live
values arrive over a WebSocket.

<img class="sr-shot sr-light" src="/SunReye/screenshots/dashboard-light.png" alt="The SunReye overview: an animated power-flow diagram beside today's energy tiles." />
<img class="sr-shot sr-dark" src="/SunReye/screenshots/dashboard-dark.png" alt="The SunReye overview: an animated power-flow diagram beside today's energy tiles." />

## The app shell

Every screen is a thin top bar over the page, plus a sidebar that is an **overlay on every
viewport** — a desktop dashboard is a thing to look at, not a thing to navigate, so the
navigation gets out of the way until you ask for it.

- **Top bar** — the sidebar trigger and the page's title and subtitle. Nothing else: it is the
  one strip that must never clip on a phone.
- **Sidebar** — opened by the trigger or **⌘/Ctrl + B**, dismissed as soon as you pick a
  destination. Its header is the brand row and the [source switcher](#source-switcher); then a
  *Monitoring* group — Overview, History, Statistics, and for admins Controls and Automations;
  then a footer carrying the connected inverter's make and model, **Settings** (admins), the
  signed-in user, and **Sign out**. A viewer who is not signed in — on a
  [public dashboard](/use/settings/#access) — gets a **Log in** entry there instead.

<img class="sr-shot sr-light" src="/SunReye/screenshots/sidebar-light.png" alt="The sidebar overlay: brand and source row, the Monitoring group, and the account footer." />
<img class="sr-shot sr-dark" src="/SunReye/screenshots/sidebar-dark.png" alt="The sidebar overlay: brand and source row, the Monitoring group, and the account footer." />

### Source switcher

The brand row at the top of the sidebar names what you are looking at — **the plant**, or **one
device** — and switches it. It sits in the navigation chrome rather than on a page on purpose:
the source chosen on the overview is the source the Statistics page prices and the History page
plots. One scope for the whole app, not one per screen.

Choosing the plant aggregates by role across every device; choosing a device reads just that
one, under its own slug. A plant with a single source shows the same row without a menu, so the
sidebar looks the same on every instance.

## Power flow

The hero: an animated single-line schematic of **PV strings ▸ Inverter ▸ Grid**, with
**Battery**, **Load** and **Generator** branching off. Only present subsystems are drawn. Each
node shows an icon, its live power, and a direction-sensed state — PV *Producing/Idle*, Battery
*Charging/Discharging/Idle*, Grid *Importing/Exporting*. Animated flow lines carry direction and
scale their speed to the wattage; the grid line is cost-coloured (green exporting, red
importing) and the battery node carries a circular SoC gauge.

The diagram adapts to the shape of its box: stacked on a phone, fanned out on a wide one.

### Node details

**Tap any node** to open that subsystem's readings — its own quantity charted on top, then
everything else the profile maps for it: the battery's remaining metrics, the inverter's status
and temperatures, per-string solar power/voltage/current, per-phase grid figures, the generator,
the backup load. This is what the old `/system` page used to lay out as a wall of panels; it now
lives behind the node it belongs to.

<img class="sr-shot sr-light" src="/SunReye/screenshots/node-detail-light.png" alt="The battery node's dialog: state of charge, a live power chart, and the rest of the pack's metrics." />
<img class="sr-shot sr-dark" src="/SunReye/screenshots/node-detail-dark.png" alt="The battery node's dialog: state of charge, a live power chart, and the rest of the pack's metrics." />

## Today's energy and money

Beside the hero (below it on a phone), a strip of tiles for the day so far: **production**,
**consumption**, **feed-in** and **grid purchase**. Each carries the day's kWh and, where the
figure exists, a ratio with a meter bar (self-consumption on production, autarky on
consumption) and a money line — solar saved, export earned, grid paid — priced from the
[tariff](/use/settings/#tariff). The rows line up across the strip, so a tile without a ratio
still holds its slot rather than shuffling its neighbours.

Every tile opens a **detail dialog** breaking the day down as a stacked bar chart —
consumption by source, production, feed-in, purchase. A day with nothing recorded yet says so
rather than drawing an empty chart.

## Weather

A compact tile with current conditions, shown only once a plant **location** is set under
[Settings → Weather](/use/settings/#weather--forecast). With the solar forecast enabled the
tile also carries the forecast figures, and opens a dialog with the day's expected production
curve. Weather being off renders nothing — no ghost gap.

## Car (EVCC)

When [EVCC](/integrations/evcc/) is enabled, reachable and has loadpoints, one tile per
loadpoint joins the strip: charging state, power, and the vehicle's state of charge. Admins get
a dialog with quick settings (mode, limits); everyone else sees the same tile read-only.

## Install on your phone

The dashboard is a progressive web app: open it in a mobile browser and use **Install app**
(Chrome / Edge on Android) or **Share → Add to Home Screen** (Safari on iOS) to get a
full-screen icon on the home screen. There is no offline mode — the app needs the live
socket — and nothing is cached, so an upgraded server always loads the matching UI.

Install from a URL you can open on its own: a direct port, a reverse-proxy hostname, or the
compose `web` service. The Home Assistant sidebar embeds the app in an iframe behind an ingress
session that only the HA frontend keeps alive, so an icon pinned to that URL logs you out — see
[Direct access](/deploy/home-assistant/#options-worth-knowing) for opening the addon's port.

## Related

- Dig into any metric over time in [History & Analytics](/use/history/).
- Read the money and the long-run figures in [Statistics](/use/statistics/).
- Change writable settings in [Controls](/use/controls/), or let a loop do it in
  [Automations](/use/automations/).
