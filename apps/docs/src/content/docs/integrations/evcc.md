---
title: EVCC
description: Show your EVCC-managed EV charger on the SunReye dashboard, over MQTT.
---

SunReye can surface an [EVCC](https://evcc.io/) instance's EV charger(s) on the dashboard:
an **EV node in the power-flow diagram** (branching off the house load), and an **EV card**
with live charge power, vehicle state of charge and range, session energy — plus
quick-settings for the charge mode and charge limit.

The data flows over MQTT: EVCC publishes its full state as retained topics and accepts
commands on `.../set` topics, so no EVCC login or API token is needed — only a shared
broker.

## Prerequisites

- A broker configured in [Settings → MQTT & Home Assistant](/use/settings/). Only the
  broker connection is reused — the **Enabled** toggle there (inverter→MQTT publishing) does
  not need to be on.
- EVCC publishing to that broker: an `mqtt` block in your `evcc.yaml`
  ([EVCC docs](https://docs.evcc.io/docs/reference/configuration/mqtt/)):

  ```yaml
  mqtt:
    broker: mqtt://your-broker:1883
    topic: evcc # SunReye's "topic root" must match this
    # user / password if your broker requires them
  ```

## Enabling

In [Settings → MQTT & Home Assistant](/use/settings/), scroll to the **EVCC** section:

1. Turn on **Enabled**.
2. Set the **topic root** to EVCC's `mqtt.topic` (default `evcc`).
3. Save. The subscription (re)connects live — no restart.

Once EVCC's retained state arrives, the EV card appears on the overview and the charger
node joins the power-flow diagram. Until then (EVCC offline, wrong topic root, EVCC not
publishing) both stay hidden.

### EV metered in house load

The inverter's **Load** figure is the total AC load it serves. Whether that already includes
the EV depends on your wiring:

- **Charger wired on the inverter's load output** → the EV draw is inside `load.power`. Turn
  **EV metered in house load** on to split it out: the load node becomes **Home** = load − EV
  and the EV gets its own node, so Home and EV read as distinct, non-overlapping figures.
- **Charger wired on the grid side** → `load.power` never included the EV. Leave the toggle
  **off** (the default); the EV shows as an informational sub-branch and the Load figure is
  untouched. Turning it on here would wrongly subtract the EV twice.

The two independent samples (Modbus load, EVCC charge power) can skew briefly, so a
transiently negative Home is clamped to 0.

## What you get

- **Power flow**: an EV node attached to the house-load node. The EV's draw is already part
  of the load figure, so by default it renders as a labeled sub-branch — the spine totals
  stay honest. With a single loadpoint, the vehicle's state of charge rings the node.
  Optionally (see **EV metered in house load** below) the load node instead becomes **Home**
  = load − EV, with the EV split out as its own node.
- **EV card** (one per loadpoint): status (charging / plugged in / disconnected), charge
  power, vehicle name, SoC and range, session energy, and the active charge mode.
- **Quick-settings** (admins only, tap the card): the four EVCC charge modes — Off, Solar,
  Min + Solar, Fast — and a charge-limit slider (0 = no limit). Commands are
  published to EVCC's `/set` topics; the card reflects the new state as soon as EVCC
  republishes it (typically ~2 s).

## How it works

SunReye runs a dedicated MQTT client (independent of the inverter bridge) subscribed to:

| Topic | Purpose |
| --- | --- |
| `<root>/status` | EVCC's own online/offline (Last-Will) — drives reachability. |
| `<root>/loadpoints/#` | Retained per-loadpoint state (`chargePower`, `vehicleSoc`, …). |
| `<root>/vehicles/#` | Retained per-vehicle state — which cars EVCC knows, for the charge-limit write. |

Mode commands go to `<root>/loadpoints/<n>/mode/set`.

### The charge limit

EVCC stores the limit in three places, and SunReye follows its lead:

| Topic | Meaning |
| --- | --- |
| `<root>/vehicles/<name>/limitSoc` | The car's **configured** limit — durable, survives unplug and restart. |
| `<root>/loadpoints/<n>/limitSoc` | A per-**session** override. `0` means "no override", not "no limit"; EVCC clears it when the session ends. |
| `<root>/loadpoints/<n>/effectiveLimitSoc` | EVCC's resolution of the two — the value its own UI shows. |

SunReye **displays** `effectiveLimitSoc` and **writes** to
`<root>/vehicles/<name>/limitSoc/set` whenever the loadpoint reports a vehicle EVCC knows,
so the limit sticks. If no vehicle is identified (a guest car, or none configured), it
writes the session override at `<root>/loadpoints/<n>/limitSoc/set` instead.

The loadpoint's `vehicleLimitSoc` — the limit read *from the car* — is informational and
takes no part in this.

### What price-aware charging borrows

If you turn on **Use the car as a sink** in [peak shaving](/use/settings/#automations), the
automation writes three loadpoint topics, and hands each one back when the window is over —
or when the automation stops for any other reason.

| Topic | Written when |
| --- | --- |
| `<root>/loadpoints/<n>/mode/set` | Only to wake an **idle** charger (`off` → `pv`). A charger already on `pv`/`minpv` keeps the mode you set, and one on `now` is left alone entirely. |
| `<root>/loadpoints/<n>/batteryBoostLimit/set` | The house-battery SOC the car may drain to. EVCC **persists** this one, which is why SunReye restores it. |
| `<root>/loadpoints/<n>/batteryBoost/set` | While the battery is too full to make room for the window on its own. Switched off once the window starts. |

Order matters and SunReye follows EVCC's rules: a mode change clears any boost, and EVCC
refuses a boost outside the `pv`/`minpv` modes — so the mode command goes first and the boost
last. If a boost is rejected because the mode command had not landed yet, the next tick sees
it missing and asks again.

Nothing is republished once a loadpoint already reads back the wanted state, so the borrowed
values stay yours rather than being overwritten by SunReye's own on the next tick. And if you
change the charge mode yourself while SunReye holds a loadpoint, it lets the mode go rather
than handing back a snapshot that is older than your decision — only the boost settings, which
EVCC persists, are still restored.

Because EVCC retains its state topics, SunReye has a complete snapshot within a second of
connecting. If the broker drops or EVCC's status flips to `offline`, the dashboard hides
the EV surfaces instead of showing stale data.

The dashboard receives updates over a **WebSocket** (`/ws/evcc`), not polling: the server
coalesces the MQTT burst and pushes each fresh snapshot, so the EV node and card move in
near real time. A new subscriber gets the current snapshot the moment it connects, and the
socket reconnects with backoff if it drops.
