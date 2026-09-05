/**
 * Home Assistant MQTT Discovery payloads for the bridge in {@link ./mqtt}.
 *
 * Split out because it is pure, table-driven mapping — profile metric +
 * constraint → HA component and config object — with no broker, no client and
 * no lifecycle. That keeps {@link ./mqtt} to connection handling and lets the
 * payload shapes be unit-tested directly (see mqtt.test.ts).
 *
 * ## IDENTITY IS THE SLUGS. DESCRIPTION IS THE PROFILE.
 *
 * Every name in this file that Home Assistant KEYS ON — the topic namespace, the
 * `unique_id`, the discovery object node, the HA device `identifiers` — is built
 * from {@link MqttNamespace}: the FROZEN `plants.slug` and `devices.slug`. Nothing
 * identifying is built from the profile id any more.
 *
 * Until 2.0.0 all of it was `profile.id`, and that is the defect this release
 * exists to end. HA keys its entities on `unique_id` and a discovery announcement
 * is RETAINED on the broker, so changing a `unique_id` does not RENAME an entity:
 * the old announcement is still sitting on the broker, so the old entity stays,
 * the new one appears beside it, and every dashboard card, automation, script and
 * statistic that named the old id now points at a thing that will never update
 * again. Nothing errors. So correcting a typo in a profile id, or swapping a
 * mis-detected profile for the right one, silently broke the operator's whole
 * Home Assistant. The slugs cannot move — `packages/db/src/schema/plants.ts` and
 * `./provision.ts` freeze them at creation precisely so this namespace never has
 * to — which is why identity hangs off them.
 *
 * What DOES follow a profile swap is the DESCRIPTION: `manufacturer` and `model`
 * on the HA device. Those describe the hardware, and if the profile was wrong the
 * description was wrong; correcting it must correct them. HA re-reads a device
 * block on every announcement and updates the fields in place, keyed on
 * `identifiers` — so a swap re-labels the device the operator already has instead
 * of creating a second one. That is the entire distinction: identity must be
 * stable, description should track the hardware.
 */

import type { EntityConstraint, ManifestMetric } from "@SunReye/inverter-core";
import type { ForecastVariant } from "../forecast/solar-forecast";

/**
 * The HA device all of one bridge's entities attach to.
 *
 * `identifiers` is IDENTITY and is slug-derived; `manufacturer` and `model` are
 * DESCRIPTION and stay profile-derived. See the module note.
 */
export type HaDevice = {
  identifiers: string[];
  name: string;
  manufacturer: string;
  model: string;
};

/**
 * The two frozen slugs every identifying name in this module is built from.
 *
 * `plantSlug` is `plants.slug`, `deviceSlug` is `devices.slug` — both written once
 * at creation and unchangeable afterwards (see `packages/db/src/schema/plants.ts`
 * and `./provision.ts`, "SLUGS ARE FROZEN, NAMES ARE NOT"). Passed as a value
 * rather than looked up here so this file stays pure and so the bridge cannot
 * accidentally use one and not the other.
 *
 * Both fields are REQUIRED with no default on purpose. A fallback to the profile
 * id — "use the slug if we have one" — is how the defect this release fixes
 * survived so long: it kept working, so nothing ever failed loudly enough to be
 * noticed. Omitting either slug at the call site is a compile error instead.
 */
export interface MqttNamespace {
  /** FROZEN — `plants.slug`. */
  plantSlug: string;
  /** FROZEN — `devices.slug`. */
  deviceSlug: string;
}

/** HA object ids / unique ids must be a restricted charset; keys are dotted. */
export const slug = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, "_");

/**
 * The identity prefix every `unique_id` and the HA device `identifiers` share:
 * `sunreye_<plant-slug>_<device-slug>`.
 *
 * THE PLANT SLUG IS IN HERE DELIBERATELY, and it is the one judgement call in the
 * shape. There is one plant today and it is frozen, so leaving it out would be
 * shorter and would read fine. It is included because `devices.slug` is unique
 * per `(plant_id, slug)` and NOT globally — `devices_plant_slug_key` says exactly
 * that — so "inverter" alone is not a key by the schema's own definition. Home
 * Assistant is an AGGREGATOR: two SunReye instances (a house and a holiday home,
 * a test box beside the real one) publishing to one HA is an ordinary deployment,
 * and both would provision a `role = 'inverter'` device whose default slug is
 * "inverter". On a `unique_id` collision HA does not warn — it silently refuses
 * the second entity, so the second plant would simply have no entities and no
 * message saying why. That failure is invisible and unfixable-in-place (the
 * `unique_id` is permanent), while the cost of including the plant slug is a
 * longer string, paid once. Cheap insurance against a silent, permanent loss
 * beats a shorter id.
 *
 * The `sunreye_` prefix stays: it is what makes a topic under the shared
 * `homeassistant/` discovery prefix identifiably OURS, which is what lets
 * `./mqtt-legacy-retire.ts` clear the old announcements without touching another
 * integration's.
 */
export const identityPrefix = (ns: MqttNamespace): string =>
  `sunreye_${ns.plantSlug}_${ns.deviceSlug}`;

/**
 * A slug as a fragment of an HA `entity_id`.
 *
 * `entity_id` accepts ONLY `[a-z0-9_]`, and `slugify` emits dashes ("haus-sud"),
 * so a slug cannot be dropped into one verbatim — HA would reject the suggestion
 * and fall back to naming the entity from its friendly label instead, which is
 * exactly the unpredictable id this change is trying to stop happening. Folded,
 * not stripped, so "inverter-2" stays two readable tokens.
 *
 * Can return `""` (a slug of nothing but separators), which the caller's template
 * absorbs — a doubled underscore is legal but ugly, so the empty segment is
 * dropped rather than emitted.
 */
const entityIdPart = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/**
 * The `entity_id` HA is asked to SUGGEST for an entity, minus its domain.
 *
 * Device-scoped, NOT plant-scoped — deliberately narrower than
 * {@link identityPrefix}. `default_entity_id` is only a suggestion: when two
 * entities want one, HA appends `_2` and shows both, so a collision here is
 * visible and repairable, unlike the silent drop a duplicate `unique_id` causes.
 * That buys the right to keep this short, and an `entity_id` is the string the
 * operator actually types into automations and dashboard cards. So the plant slug
 * is paid for where it prevents a silent permanent failure and skipped where it
 * would only make every entity id longer forever.
 */
const suggestedId = (ns: MqttNamespace, objectId: string): string =>
  ["sunreye", entityIdPart(ns.deviceSlug), entityIdPart(objectId)].filter(Boolean).join("_");

/**
 * Topic builders for one device: `<prefix>/<plant-slug>/<device-slug>/...`.
 *
 * The forecast topics live under the DEVICE namespace even though a PV forecast is
 * a property of the plant, not of one inverter. They belong to the same HA device
 * and they hang off the same `availability_topic` — which reports whether THIS
 * BRIDGE is alive, not whether the plant exists — so hoisting them to
 * `<prefix>/<plant-slug>/forecast` would give those two entities an availability
 * topic rooted somewhere their own state topic is not. Worth revisiting only if a
 * plant ever has two bridges, which would need a plant-level `status` topic first.
 */
export function topicsFor(prefix: string, ns: MqttNamespace) {
  const base = `${prefix}/${ns.plantSlug}/${ns.deviceSlug}`;
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
  ns: MqttNamespace,
  haDevice: HaDevice,
): Discovery {
  const labels = m.enumLabels;
  // The HA component (domain) this entity maps to — decided by the same branches
  // below. Needed up front because `default_entity_id` (unlike the deprecated
  // `object_id` it replaces) must carry the domain prefix, e.g. `sensor.…`.
  const component = c.writable ? (labels ? "select" : "number") : "sensor";
  const shared = clean({
    name: m.label,
    unique_id: `${identityPrefix(ns)}_${slug(m.key)}`,
    // Replaces deprecated `object_id` (removed in HA Core 2026.4). HA derives the
    // suggested entity_id from this; it must include the component domain.
    default_entity_id: `${component}.${suggestedId(ns, m.key)}`,
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
  ns: MqttNamespace,
  haDevice: HaDevice,
  variant: ForecastVariant,
): Discovery {
  const key = forecastObjectId(variant);
  return {
    component: "sensor",
    config: {
      name: FORECAST_VARIANT_LABEL[variant],
      unique_id: `${identityPrefix(ns)}_${key}`,
      default_entity_id: `sensor.${suggestedId(ns, key)}`,
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
