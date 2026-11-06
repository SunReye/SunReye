## 8. `mqtt.ndjson`: MQTT and Home Assistant export

The 3.x publisher (`apps/server/src/inverter/mqtt-discovery.ts`, `mqtt.ts`, `mqtt-namespace.ts`), run over fixed inputs. One line per case,
`input` beside `output`. Bridge cases run `startMqttBridge` against a recording link: `published` is what each step put on the wire in order,
`options` is what the publisher passed (`{retain:true}`; an absent `qos` is QoS 0), `will` is the last will it declared. A JSON payload is
`json` (parsed), anything else `payload` (verbatim). `catalog/main` holds the metric catalog, the register each metric decodes from and the forecast input
every bridge case shares.

Facts the core must decide about:

- **Slugs are not re-slugged.** `topicsFor` and `identityPrefix` take the namespace verbatim; only `readMqttNamespace` refuses a blank slug.
- **The payload is `String(value)`.** A decoded `1234 * 0.1 - 100` goes out as `23.400000000000006`; there is no rounding in the publisher.
- **Samples are published by arrival, not by age.** A sample from before midnight goes out unchanged; an absent register publishes nothing and the retained last value stays.
- **Offline publishes nothing.** The forecast is remembered while offline and restored on connect.
- **No command topic.** `number` and `select` (writable metrics) are the only kinds that carry `command_topic` and `/set`; ADR 0005 drops them, no case records them.

| group | cases |
| --- | --- |
| catalog | `catalog/main` |
| slugging | `slug/metric-keys` (`slug` of dotted keys, spaces, umlauts, empty), `slugify/device-names` (device names with spaces, dots, umlauts, empty) |
| namespace from the plant spine | `namespace/plain`, `namespace/slug-of-an-umlaut-name`, `namespace/retired-lowest-id` (a retired device never names the namespace), `namespace/blank-device-slug`, `namespace/no-plant` |
| topics | `topics/plain`, `topics/custom-prefix`, `topics/awkward-slugs-verbatim`, `topics/empty-slugs-verbatim`, `topics/no-command-topic` (every topic and subscription of a full run: none ends in `/set`, none carries `command_topic`) |
| entity kinds, sensor | `discovery/sensor-power` (W), `discovery/sensor-apparent-power` (VA), `discovery/sensor-energy-cumulative` (kWh, `total_increasing`), `discovery/sensor-voltage`, `discovery/sensor-current`, `discovery/sensor-frequency`, `discovery/sensor-temperature`, `discovery/sensor-battery-soc` (`%` in the SOC role is `battery`), `discovery/sensor-percent-plain` (`%` otherwise has no class), `discovery/sensor-unitless`, `discovery/sensor-unit-without-class` (a unit with no device class), `discovery/sensor-enum-label` (value template renders the label), `discovery/sensor-status-no-state-class` (a status metric has no `state_class`) |
| entity kinds, forecast | `discovery/forecast-raw`, `discovery/forecast-usable` (kWh energy sensors, `json_attributes_topic`, own `unique_id`) |
| identity | `discovery/dashed-device-slug` (entity id folds dashes), `discovery/separator-only-device-slug` (empty segment dropped), `discovery/profile-swap` (identity keeps, `device.model` follows the profile) |
| bridge | `bridge/connect` (online retained, last will), `bridge/connect-discovery` (every metric, then both forecasts), `bridge/discovery-custom-prefixes`, `bridge/reconnect-republishes`, `bridge/close` (offline retained) |
| state cycle | `state/rounding-and-sign`, `state/zero-and-missing`, `state/empty-sample`, `state/stale-sample-across-midnight`, `state/offline-publishes-nothing`, `state/second-cycle-republishes-unchanged` |
| forecast | `forecast/connected` (today's kWh and the attributes curve, retained), `forecast/null-is-a-noop`, `forecast/offline-then-restored-on-connect` |
