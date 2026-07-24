---
title: Home Assistant
description: Auto-populate SunReye entities in Home Assistant via MQTT Discovery.
---

SunReye can publish **Home Assistant MQTT Discovery** configs so that every inverter entity
appears in Home Assistant automatically — as the right component type (sensor, number,
select), grouped under one device, with availability wired up. No manual YAML.

## Prerequisites

- The [MQTT bridge](/integrations/mqtt/) must be enabled and connected to the same broker
  Home Assistant uses.
- Home Assistant's MQTT integration must be configured against that broker.

## Enabling

From [Settings → MQTT & Home Assistant](/use/settings/), turn on **Home Assistant
discovery** (this reveals the discovery prefix field, default `homeassistant`). Or seed it
via `HA_DISCOVERY_ENABLED` / `HA_DISCOVERY_PREFIX` in the
[environment](/reference/environment/).

Discovery configs are (re)published on every broker connect, so they survive broker
restarts.

## How entities map

Each entity is published to
`<discoveryPrefix>/<component>/sunreye_<inverterId>/<slug>/config` (retained). The
component type is derived from the entity's shape:

| Entity shape | HA component | Behaviour |
| --- | --- | --- |
| Writable + enum labels | **select** | Dropdown; label ↔ raw-value templates map both ways. |
| Writable, numeric | **number** | Box input with the entity's `min` / `max`. |
| Read-only + enum labels | **sensor** | Renders the human-readable label. |
| Everything else | **sensor** | With `device_class` + `state_class` where known. |

### Device classes and state classes

`device_class` is inferred from the entity's unit — W → power, VA → apparent_power, kWh →
energy, V → voltage, A → current, Hz → frequency, °C → temperature, and `%` → battery for
the battery SoC entity. `state_class` follows the metric kind — cumulative →
`total_increasing`, measurement → `measurement`.

### Production forecast

When the [PV production forecast](/use/settings/) is configured, **two** forecast sensors are
discovered alongside the entities (kWh, today's expected production):
`sensor.sunreye_forecast` (**raw**, uncurtailed potential) and
`sensor.sunreye_forecast_usable` (**usable**, after the feed-in cap + battery model). Their
**attributes** carry the full forecast, including a Solcast-style `detailedForecast` array — a
per-15-minute `{ period_start, watts }` curve — so PV-automation blueprints consume it
unmodified. For automations that act on production above your feed-in limit, read the **raw**
sensor (the usable one is already capped at that limit). See
[MQTT → Production forecast](/integrations/mqtt/).

### Device grouping

All entities are grouped under a single Home Assistant **device**, identified by
`sunreye_<inverterId>`, with the profile's name as the device name, its manufacturer, and
its id as the model. So a SunReye install shows up as one inverter device with all its
sensors and controls beneath it.

## Availability

Entities use the bridge's `<prefix>/<inverterId>/status` topic (`online` / `offline`) for
availability, so Home Assistant marks them unavailable when SunReye disconnects. See
[MQTT Bridge → Availability](/integrations/mqtt/#availability-last-will).
