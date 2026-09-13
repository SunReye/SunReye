---
title: MQTT Bridge
description: Publish every entity to MQTT topics and accept writes, generated from the profile.
---

The MQTT bridge publishes every entity to a broker as retained topics, subscribes to write
topics for writable entities, and reports availability via a Last-Will message. Like every
other surface, the topic set is generated from the active inverter's manifest.

## Enabling

The broker is a **connection**, exactly like a Modbus gateway, and the bridge is an
**integration** that runs on it. Both are set up in one place —
[Settings → Devices](/use/settings/#devices):

1. **Add device** → step 1: pick the broker, or *New connection…* and fill in its URL,
   username, password and optional client id.
2. Step 2: choose **Home Assistant export** — the entry that publishes the inverter to MQTT.
   One per broker.
3. Step 3: set the **topic prefix** (default `sunreye`), and turn on
   [Home Assistant discovery](/integrations/home-assistant/) if you want it.
4. Confirm.

The integration then appears as a row under its broker, with a switch, **Edit**, **Remove**,
and a page of its own showing when it last connected and what has failed. Enabling, disabling
or editing takes effect **live** — the bridge is rebuilt without a restart.

A first boot can still seed all of this from [environment variables](/reference/environment/)
(`MQTT_ENABLED`, `MQTT_BROKER_URL`, `MQTT_TOPIC_PREFIX`, `MQTT_USERNAME`, `MQTT_PASSWORD`): the
broker becomes a connection row and the export names it by id, so several brokers can coexist
and the [EVCC](/integrations/evcc/) ingest can subscribe on its own.

## Topic layout

All topics are rooted at `<prefix>/<inverterId>`, where `prefix` defaults to `sunreye` and
`inverterId` is the active profile's id.

| Topic | Direction | Retained | Payload |
| --- | --- | --- | --- |
| `<prefix>/<inverterId>/<topic>` | publish (state) | ✅ | The entity's value as a string. |
| `<prefix>/<inverterId>/<topic>/set` | subscribe (write) | — | A numeric value to write. |
| `<prefix>/<inverterId>/status` | publish (availability) | ✅ | `online` / `offline`. |
| `<prefix>/<inverterId>/forecast/raw` | publish (state) | ✅ | Today's **raw** (uncurtailed) production, kWh. |
| `<prefix>/<inverterId>/forecast/raw/attributes` | publish (attributes) | ✅ | The full **raw** production forecast as JSON. |
| `<prefix>/<inverterId>/forecast/usable` | publish (state) | ✅ | Today's **usable** (post-clipping) production, kWh. |
| `<prefix>/<inverterId>/forecast/usable/attributes` | publish (attributes) | ✅ | The full **usable** production forecast as JSON. |

`<topic>` is each entity's manifest topic (a `/`-separated suffix). State is published only
while connected — stale samples are not queued.

## Production forecast

When the [PV production forecast](/use/settings/) is configured, the bridge also publishes it
(retained, refreshed every ~5 minutes) — no extra toggle. It publishes **two variants**:

- **`raw`** — the uncurtailed PV *potential*. Use this for automations that act on production
  **above** your feed-in limit (peak-shaving, dynamic EV charging), since it isn't capped.
- **`usable`** — the potential **after** the feed-in cap and battery model curtail it, i.e.
  the output the plant can actually use/export. This matches the dashboard weather tile.

For each variant, `.../forecast/<variant>` carries today's kWh as the scalar state, and
`.../forecast/<variant>/attributes` carries the full forecast object as JSON: the native
SunReye fields (`series`, `todayKwh`, `remainingTodayKwh`, `tomorrowKwh`, `next15`) plus a
**`detailedForecast`** array shaped like Solcast / Forecast.Solar (`{ period_start, watts }`
per 15-minute slot, `period_start` an offset-aware ISO timestamp).

The identical objects are available over HTTP at `GET /api/forecast` (raw) and
`GET /api/forecast/usable`.

The `detailedForecast` shape lets existing Home Assistant PV-automation blueprints (feed-in
limiting, dynamic peak-shaving) read the curve straight from the sensor's attributes:

```jinja
{{ state_attr('sensor.sunreye_forecast', 'detailedForecast') }}
```

## Writes

Only writable entities get a `.../set` command topic. When a message arrives:

1. The payload is parsed as a number (`NaN` is rejected and logged).
2. The value is validated against the entity's constraint (range or enum) — the **same
   validation** used by the [REST API](/integrations/rest-api/) and the dashboard.
3. On success the write is pushed to the inverter; invalid writes are dropped with a warning.

Example (publish a new max charge current):

```bash
mosquitto_pub -t 'sunreye/deye-sg05lp3/settings/battery/max_charge_current/set' -m '40'
```

## Availability (Last-Will)

- On connect, the bridge publishes `online` (retained) to `<prefix>/<inverterId>/status`.
- A broker-registered **Last-Will** publishes `offline` (retained) if the connection drops.
- On graceful shutdown it publishes `offline` before disconnecting.

Home Assistant uses this topic for entity availability.

## Home Assistant

When Home Assistant discovery is enabled, the bridge also publishes MQTT Discovery configs
so SunReye auto-populates in Home Assistant. See [Home Assistant](/integrations/home-assistant/).
