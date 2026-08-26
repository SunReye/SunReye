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
  MetricStorage,
} from "./types";

const log = getLogger(["inverter-core", "capabilities"]);

/** The fields {@link resolveKind} reads — so the lint can ask about a bare def. */
export type KindInputs = Pick<MetricDef, "kind" | "role" | "access" | "unit">;

/**
 * {@link KindInputs} plus the key, which {@link resolveKind} needs only to name
 * the metric in its fallback report.
 *
 * Deliberately narrower than `MetricDef`: kind resolution reads five fields and
 * nothing about addressing, so it must not require a `binding`. Taking the full
 * `MetricDef` made it uncallable from `profile-sdk`'s lints, which work on the
 * wire shape (`MetricDataDef`, where `binding` is optional) — and no gate caught
 * that, because only `apps/server` had a `check-types` task.
 */
export type KindResolvable = KindInputs & Pick<MetricDef, "key">;

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
  return statedKind(def) !== undefined;
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
export function resolveKind(def: KindResolvable): MetricKind {
  const stated = statedKind(def);
  if (stated) return stated;
  reportKindFallback(def.key);
  return "measurement";
}

/**
 * The kind a metric actually states — explicitly, through its canonical role,
 * through writability or through the kWh unit — and `undefined` when nothing
 * does. {@link resolveKind} is this plus the reported `measurement` guess.
 *
 * Split out because the guess has a side effect (it is recorded and logged per
 * key) and two callers must not trip it: the profile validator, which asks about
 * a bare wire-shape def and reports its own issue, and {@link resolveStorage},
 * for which a missing kind is not a kind question at all.
 */
export function statedKind(def: KindInputs): MetricKind | undefined {
  if (def.kind) return def.kind;
  const fromRole = roleKind(def);
  if (fromRole) return fromRole;
  if (def.access === "rw") return "setting";
  if (def.unit === "kWh") return "cumulative";
  return undefined;
}

/** The fields {@link resolveStorage} reads. */
export type StorageInputs = KindInputs & Pick<MetricDef, "storage">;

/**
 * Where a metric's values are persisted: an explicit {@link MetricStorage} wins,
 * otherwise it is derived from the kind. Only `setting` derives away from the
 * hypertable — 37 of this profile's 108 metrics are configuration registers, 34 %
 * of every row written, and a schedule slot or an enum has no time-weighted mean
 * for the rollups to compute.
 *
 * The derivation is a default, not a law: the 1:1 mapping between the four kinds
 * and the storage policies is a property of one vendor's profile. A `setting` the
 * automation engine writes is worth charting, and a diagnostic `measurement` may
 * be worth no storage at all — so the author overrides, and `kind` stays a
 * rendering statement.
 */
export function resolveStorage(def: StorageInputs): MetricStorage {
  if (def.storage) return def.storage;
  return statedKind(def) === "setting" ? "config" : "series";
}

/** The fields {@link resolveDeadband} reads. */
export type DeadbandInputs = StorageInputs & Pick<MetricDef, "deadband">;

/**
 * The change threshold to filter a metric's stored series by, in the metric's
 * own unit — `undefined` meaning "store every change", which is the default and
 * the only safe one: a guessed global threshold silently degrades data.
 *
 * `undefined` regardless of what is authored for the two kinds a magnitude
 * threshold is meaningless on (a deadband makes a counter lag, and on an enum it
 * can swallow a genuine state transition) and for anything not stored as a
 * series. The schema rejects those combinations at parse time; this is the
 * runtime half of the same rule, so a hand-built def cannot route around it.
 */
export function resolveDeadband(def: DeadbandInputs): number | undefined {
  if (def.deadband === undefined) return undefined;
  if (resolveStorage(def) !== "series") return undefined;
  const kind = statedKind(def);
  return kind === "cumulative" || kind === "status" ? undefined : def.deadband;
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
    storage: resolveStorage(def),
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
