import { getLogger } from "@logtape/logtape";

import { ROLE_CATALOG } from "./roles";
import type {
  InverterCapabilities,
  InverterFeature,
  InverterManifest,
  InverterProfile,
  ManifestMetric,
  MetricDef,
  MetricKind,
} from "./types";

const log = getLogger(["inverter-core", "capabilities"]);

/** The fields {@link resolveKind} reads — so the lint can ask about a bare def. */
export type KindInputs = Pick<MetricDef, "kind" | "role" | "access" | "unit">;

/** The kind a metric's canonical role prescribes, when it carries one. */
function roleKind(def: KindInputs): MetricKind | undefined {
  return def.role ? ROLE_CATALOG[def.role].kind : undefined;
}

/**
 * Whether a metric's kind comes from somewhere real: an explicit `kind`, a
 * mapped role, writability, or the kWh unit. False means {@link resolveKind}
 * would fall through to its `measurement` default — a guess, not a statement.
 * The authoring lint (`profile validate`) reports these; the storage policy
 * keys off `resolveKind`, so a status enum guessed as a measurement would get a
 * deadband applied to an enum.
 */
export function hasResolvableKind(def: KindInputs): boolean {
  return Boolean(def.kind ?? roleKind(def)) || def.access === "rw" || def.unit === "kWh";
}

/** A metric whose kind was guessed rather than stated. */
export interface KindFallbackReport {
  key: string;
  /** How many resolutions have fallen through since the last reset. */
  count: number;
}

/**
 * Fallbacks seen so far, keyed by metric. Deliberately the same shape and
 * discipline as `ClampReport` in `./codec`: both are "a value we had to guess",
 * both repeat every poll, so both count per key and log only the first time.
 * One mechanism, not two.
 */
const kindFallbacks = new Map<string, KindFallbackReport>();

/** Every metric whose kind was guessed since the last {@link resetKindFallbacks}. */
export function kindFallbackReports(): readonly KindFallbackReport[] {
  return [...kindFallbacks.values()];
}

/** Just the keys, in first-seen order. */
export function kindFallbackKeys(): readonly string[] {
  return [...kindFallbacks.keys()];
}

/** Forget every recorded fallback (a profile swap, or a test). */
export function resetKindFallbacks(): void {
  kindFallbacks.clear();
}

function reportKindFallback(key: string): void {
  const seen = kindFallbacks.get(key);
  if (seen) {
    seen.count += 1;
    return;
  }
  kindFallbacks.set(key, { key, count: 1 });
  log.warn(
    '{key} has no resolvable kind — defaulting to "measurement". Give it an explicit kind or a canonical role.',
    { key },
  );
}

/**
 * Effective {@link MetricKind}: an explicit `kind` wins, then the kind its
 * canonical role prescribes, then access (writable -> setting) and unit (kWh ->
 * cumulative). Anything left defaults to a plain measurement — reported once per
 * key rather than assumed silently, since that default is a guess.
 */
export function resolveKind(def: MetricDef): MetricKind {
  if (def.kind) return def.kind;
  const fromRole = roleKind(def);
  if (fromRole) return fromRole;
  if (def.access === "rw") return "setting";
  if (def.unit === "kWh") return "cumulative";
  reportKindFallback(def.key);
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
