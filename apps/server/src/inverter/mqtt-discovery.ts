/**
 * Home Assistant MQTT Discovery payloads for the bridge in {@link ./mqtt}.
 *
 * Split out because it is pure, table-driven mapping — profile metric +
 * constraint → HA component and config object — with no broker, no client and
 * no lifecycle. That keeps {@link ./mqtt} to connection handling and lets the
 * payload shapes be unit-tested directly (see mqtt.test.ts).
 */

import type { EntityConstraint, ManifestMetric } from "@SunReye/inverter-core";
import type { ForecastVariant } from "../forecast/solar-forecast";

/** The stable HA device (per profile) that all entities attach to. */
export type HaDevice = {
  identifiers: string[];
  name: string;
  manufacturer: string;
  model: string;
};

/** HA object ids / unique ids must be a restricted charset; keys are dotted. */
export const slug = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, "_");

/** Topic builders for a given prefix (`<prefix>/<inverterId>/...`). */
export function topicsFor(prefix: string, profileId: string) {
  const base = `${prefix}/${profileId}`;
  return {
    base,
    availability: `${base}/status`,
    state: (m: ManifestMetric): string => `${base}/${m.topic}`,
    command: (m: ManifestMetric): string => `${base}/${m.topic}/set`,
    // PV production forecast, per variant (`raw` potential vs `usable` post-clipping):
    // a scalar state (today's kWh) plus the full forecast as retained JSON attributes.
    forecastState: (v: ForecastVariant): string => `${base}/forecast/${v}`,
    forecastAttrs: (v: ForecastVariant): string => `${base}/forecast/${v}/attributes`,
  };
}

/** The topic set one bridge instance publishes on. */
export type Topics = ReturnType<typeof topicsFor>;

/** HA `device_class` by unit. `%` depends on role, so it's handled separately. */
const DEVICE_CLASS_BY_UNIT: Record<string, string> = {
  W: "power",
  VA: "apparent_power",
  kWh: "energy",
  V: "voltage",
  A: "current",
  Hz: "frequency",
  "°C": "temperature",
};

/** HA `device_class`, inferred from unit/role. Omitted when nothing fits. */
function deviceClass(m: ManifestMetric): string | undefined {
  if (m.unit === "%") return m.role === "battery.soc" ? "battery" : undefined;
  return m.unit ? DEVICE_CLASS_BY_UNIT[m.unit] : undefined;
}

/** HA `state_class`: cumulative counters increase monotonically, else a scalar. */
function stateClass(m: ManifestMetric): string | undefined {
  if (m.kind === "cumulative") return "total_increasing";
  if (m.kind === "measurement") return "measurement";
  return undefined;
}

/** Drop `undefined`-valued keys so optional HA config fields are simply absent. */
function clean<T extends Record<string, unknown>>(config: T): T {
  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)) as T;
}

/** Jinja mapping a published raw value to its friendly enum label (state side). */
const valueToLabelTemplate = (labels: Record<number, string>): string =>
  `{% set m = ${JSON.stringify(labels)} %}{{ m[value] if value in m else value }}`;

/** One discovery announcement: the HA component and the config it publishes. */
export type Discovery = { component: string; config: Record<string, unknown> };

/**
 * HA `number` entities default their range to **0–100** when `min`/`max` are
 * omitted, silently rejecting any real setpoint above 100 (e.g. a 6000 W TOU
 * power). When a profile metric declares no `range`, fall back to this permissive
 * envelope so a missing range degrades to "accept realistic values" instead of
 * "reject > 100". Declaring an explicit `range` on the metric is still the right
 * fix — it renders a bounded slider and clamps writes; this is only a safety net
 * (notably for downloaded data profiles that may omit ranges).
 */
const NUMBER_RANGE_FALLBACK = { min: 0, max: 100_000 };

/**
 * The HA discovery component for an entity and its config payload.
 *
 * - writable enum → `select` (options are the friendly labels; templates map
 *   label ↔ raw value both ways).
 * - writable number → `number` (min/max from the profile range).
 * - read-only enum/status → `sensor` with a template that renders the label.
 * - everything else → `sensor` with device/state class.
 */
export function discoveryConfig(
  m: ManifestMetric,
  c: EntityConstraint,
  topics: Topics,
  profileId: string,
  haDevice: HaDevice,
): Discovery {
  const labels = m.enumLabels;
  // The HA component (domain) this entity maps to — decided by the same branches
  // below. Needed up front because `default_entity_id` (unlike the deprecated
  // `object_id` it replaces) must carry the domain prefix, e.g. `sensor.…`.
  const component = c.writable ? (labels ? "select" : "number") : "sensor";
  const shared = clean({
    name: m.label,
    unique_id: `sunreye_${profileId}_${slug(m.key)}`,
    // Replaces deprecated `object_id` (removed in HA Core 2026.4). HA derives the
    // suggested entity_id from this; it must include the component domain.
    default_entity_id: `${component}.sunreye_${slug(m.key)}`,
    state_topic: topics.state(m),
    availability_topic: topics.availability,
    unit_of_measurement: m.unit ?? undefined,
    device: haDevice,
  });

  if (c.writable && labels) {
    // label→value for commands, value→label for state display.
    const toValue = Object.fromEntries(Object.entries(labels).map(([v, l]) => [l, Number(v)]));
    return {
      component: "select",
      config: {
        ...shared,
        command_topic: topics.command(m),
        options: Object.values(labels),
        command_template: `{% set m = ${JSON.stringify(toValue)} %}{{ m[value] }}`,
        value_template: valueToLabelTemplate(labels),
      },
    };
  }

  if (c.writable) {
    return {
      component: "number",
      config: clean({
        ...shared,
        command_topic: topics.command(m),
        min: c.min ?? NUMBER_RANGE_FALLBACK.min,
        max: c.max ?? NUMBER_RANGE_FALLBACK.max,
        mode: "box",
        device_class: deviceClass(m),
      }),
    };
  }

  if (labels) {
    return {
      component: "sensor",
      config: { ...shared, value_template: valueToLabelTemplate(labels) },
    };
  }

  return {
    component: "sensor",
    config: clean({ ...shared, device_class: deviceClass(m), state_class: stateClass(m) }),
  };
}

/** Human-readable suffix per forecast variant, for the HA sensor name. */
const FORECAST_VARIANT_LABEL: Record<ForecastVariant, string> = {
  raw: "Solar forecast",
  usable: "Solar forecast (usable)",
};

/** The two forecast variants published/discovered, in a stable order. */
export const FORECAST_VARIANTS: ForecastVariant[] = ["raw", "usable"];

/** Object-id suffix of a forecast variant's discovery/state topics. */
export const forecastObjectId = (variant: ForecastVariant): string =>
  variant === "raw" ? "forecast" : `forecast_${variant}`;

/**
 * HA discovery config for a PV production forecast sensor (one per variant: `raw`
 * potential and `usable` post-clipping). State is today's expected kWh; the
 * full forecast — including the Solcast-style `detailedForecast` curve — rides
 * `json_attributes_topic` so blueprints read it via `state_attr`.
 */
export function forecastDiscoveryConfig(
  topics: Topics,
  profileId: string,
  haDevice: HaDevice,
  variant: ForecastVariant,
): Discovery {
  const key = forecastObjectId(variant);
  return {
    component: "sensor",
    config: {
      name: FORECAST_VARIANT_LABEL[variant],
      unique_id: `sunreye_${profileId}_${key}`,
      default_entity_id: `sensor.sunreye_${profileId}_${key}`,
      state_topic: topics.forecastState(variant),
      json_attributes_topic: topics.forecastAttrs(variant),
      availability_topic: topics.availability,
      unit_of_measurement: "kWh",
      device_class: "energy",
      // A forecast, not a meter reading: it revises up and down as the provider
      // updates, so it's a measurement, not a monotonic `total_increasing`.
      state_class: "measurement",
      device: haDevice,
    },
  };
}
