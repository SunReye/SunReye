import type {
  InverterCapabilities,
  InverterFeature,
  InverterManifest,
  InverterProfile,
  ManifestMetric,
  MetricDef,
  MetricKind,
} from "./types";

/**
 * Effective {@link MetricKind}: an explicit `kind` wins, otherwise inferred from
 * access (writable → setting) and unit (kWh → cumulative), defaulting to a
 * plain measurement. Keeps profiles from having to annotate every metric.
 */
export function resolveKind(def: MetricDef): MetricKind {
  if (def.kind) return def.kind;
  if (def.access === "rw") return "setting";
  if (def.unit === "kWh") return "cumulative";
  return "measurement";
}

/** Count distinct 1-based indices for an indexed role (e.g. PV strings). */
function countIndices(metrics: MetricDef[], role: string): number {
  const seen = new Set<number>();
  for (const m of metrics) {
    if (m.role === role && m.index !== undefined) seen.add(m.index);
  }
  return seen.size;
}

const hasRole = (metrics: MetricDef[], prefix: string): boolean =>
  metrics.some((m) => m.role?.startsWith(prefix));

/**
 * A feature is present when any metric in the profile matches its rule. Order
 * here is the order features appear in {@link InverterCapabilities.features}.
 */
const FEATURE_RULES: { feature: InverterFeature; match: (m: MetricDef) => boolean }[] = [
  { feature: "solar_sell", match: (m) => m.role === "setting.solar_sell.enabled" },
  { feature: "grid_charge", match: (m) => m.role === "setting.battery.grid_charge" },
  { feature: "time_of_use", match: (m) => m.group === "timeofuse" },
];

/** The boolean subsystem capabilities, each keyed by the role prefix that signals it. */
type SubsystemKey = "battery" | "grid" | "generator" | "backupLoad";
const SUBSYSTEMS: Record<SubsystemKey, string> = {
  battery: "battery.",
  grid: "grid.",
  generator: "generator.",
  backupLoad: "load.",
};

/**
 * Derive what the inverter can do from the roles/groups present in its profile.
 * Presence of a canonical role is the signal — no per-inverter probing in the UI.
 */
export function deriveCapabilities(profile: InverterProfile): InverterCapabilities {
  const metrics = profile.metrics;

  const features = FEATURE_RULES.filter((rule) => metrics.some(rule.match)).map((r) => r.feature);
  const has = (key: SubsystemKey): boolean => hasRole(metrics, SUBSYSTEMS[key]);

  return {
    battery: has("battery"),
    pvStrings: countIndices(metrics, "pv.string.power"),
    phases: Math.max(1, countIndices(metrics, "grid.phase.voltage")),
    grid: has("grid"),
    generator: has("generator"),
    backupLoad: has("backupLoad"),
    features,
    controls: metrics.filter((m) => m.access === "rw").map((m) => m.key),
  };
}

/** Serialize a metric to its render-ready form (drops functions/addresses). */
export function toManifestMetric(def: MetricDef): ManifestMetric {
  return {
    key: def.key,
    topic: def.topic,
    label: def.label,
    unit: def.unit,
    group: def.group,
    kind: resolveKind(def),
    writable: def.access === "rw",
    role: def.role,
    index: def.index,
    range: def.range,
    enumLabels: def.enumLabels,
    flow: def.flow,
  };
}

/** Build the full client contract: identity + capabilities + metric catalog. */
export function buildManifest(profile: InverterProfile): InverterManifest {
  return {
    id: profile.id,
    name: profile.name,
    manufacturer: profile.manufacturer,
    capabilities: deriveCapabilities(profile),
    metrics: profile.metrics.map(toManifestMetric),
  };
}
