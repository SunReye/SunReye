import type { CanonicalRole } from "./roles";
import type { InverterProfile, MetricBase, MetricDef, MetricValues, SimulateFn } from "./types";

/**
 * Serializable inverter profile — the downloadable artifact and DB row. It is a
 * pure-data mirror of {@link InverterProfile}: the `compute` closure becomes a
 * declarative {@link ComputeExpr}, and there is no `simulate` hook (data
 * profiles fall back to generic synthesis). {@link hydrateProfile} turns it back
 * into the runtime {@link InverterProfile} the engine consumes, so nothing
 * downstream of the registry has to know a profile came from data vs. code.
 */
export interface ProfileData {
  /** Bumped when the serialized shape changes; validated on load. */
  schemaVersion: 1;
  id: string;
  name: string;
  manufacturer: string;
  /** Semver of the profile content itself (drives update detection). */
  version: string;
  metrics: MetricDataDef[];
}

/**
 * Declarative replacement for a `compute` closure. A small, closed set — never
 * arbitrary code — so a downloaded profile can never execute. Referenced keys
 * are resolved from the sample at compute time; a missing key reads as 0.
 *
 * - `sum`     add the listed metric keys.
 * - `diff`    first minus second.
 * - `scale`   a metric key times a constant.
 * - `combine` sum of `add` keys minus sum of `sub` keys (a signed linear mix).
 * - `ratio`   (sum of `num` / sum of `den`) times `scale` (default 1); a zero
 *             denominator reads as 0 so night/idle samples never divide by zero.
 * - `clamp`   a single metric key bounded to `[min, max]` (either bound may be
 *             omitted); e.g. `{ clamp: { key, min: 0 } }` is the positive part
 *             `max(0, x)`, letting a profile define a directional operand (grid
 *             import only, battery discharge only) to feed a signed `ratio`.
 */
export type ComputeExpr =
  | { sum: string[] }
  | { diff: [string, string] }
  | { scale: [string, number] }
  | { combine: { add: string[]; sub?: string[] } }
  | { ratio: { num: string[]; den: string[]; scale?: number } }
  | { clamp: { key: string; min?: number; max?: number } };

/**
 * Author-time selector for a deferred aggregate ({@link AggregateExpr}). Names
 * the members to fold in *by intent*, not by hand-listed keys:
 * - `role`      every metric carrying this {@link CanonicalRole}.
 * - `keyPrefix` the exact key, plus every `${keyPrefix}.` descendant.
 */
export type AggregateMatch = { role: CanonicalRole } | { keyPrefix: string };

/**
 * A deferred aggregate produced by `sumOf` — the intent "sum every PV-string
 * power", written once, instead of a hand-copied key list that drifts the
 * moment a variant drops a string. Resolved against the *final* metric set at
 * build time ({@link "./define".defineProfile}/`defineVariant`) into a concrete
 * {@link ComputeExpr}, so an emitted profile only ever carries the closed form —
 * a profile that still holds one fails validation. Fail-loud: an aggregate that
 * matches zero metrics is a build error, never a silent empty sum.
 */
export interface AggregateExpr {
  readonly __aggregate: { op: "sum"; match: AggregateMatch };
}

/**
 * Declarative composite control — the write-side mirror of {@link ComputeExpr}.
 * A metric carrying one has no register of its own; writing to it runs a trusted
 * interpreter (server-side, since it has I/O side effects) that issues writes to
 * real target register(s). Like `computeExpr`, it is a small closed set, never
 * arbitrary code, so a downloaded profile can never execute. Every `target` must
 * resolve to a writable, non-composite metric key.
 *
 * - `snapshotToggle` a boolean control: on `1` snapshot `target`'s live value
 *   and write `lockedValue`; on `0` restore the snapshot. Stateful (the snapshot
 *   is persisted by the runtime).
 * - `preset`         write a fixed list of `target`→`value`. Stateless.
 */
export type ControlExpr<K extends string = string> =
  | { snapshotToggle: { target: K; lockedValue: number } }
  | { preset: { writes: { target: K; value: number }[] } };

/**
 * Canonical key derived from an MQTT topic — the type-level mirror of the
 * runtime `topic.replaceAll("/", ".")`. Lets {@link control} constrain a
 * composite control's `target` to the profile's real keys, so authoring gets
 * IDE autocomplete and typos are compile errors instead of parse-time failures.
 */
export type TopicToKey<T extends string> = T extends `${infer H}/${infer R}`
  ? `${H}.${TopicToKey<R>}`
  : T;

/**
 * {@link MetricDef} without runtime-only fields: `compute` → `computeExpr`.
 * Everything else is shared, so it comes from {@link MetricBase}.
 */
export interface MetricDataDef extends MetricBase {
  /** Declarative derived value; mutually exclusive with reading from the wire. */
  computeExpr?: ComputeExpr;
  /**
   * Author-time deferred aggregate; resolved into {@link computeExpr} against the
   * final metric set by `defineProfile`/`defineVariant` and stripped before the
   * profile is emitted. Never present in a validated profile.
   */
  computeAggregate?: AggregateExpr;
}

/**
 * Metric keys a {@link ComputeExpr} reads. Kept alongside the compiled closure
 * (as {@link MetricDef.computeInputs}) so the read planner can group a computed
 * metric's raw registers into one atomic Modbus read.
 *
 * @internal
 */
export function computeExprInputs(expr: ComputeExpr): string[] {
  if ("sum" in expr) return [...expr.sum];
  if ("diff" in expr) return [...expr.diff];
  if ("scale" in expr) return [expr.scale[0]];
  if ("combine" in expr) return [...expr.combine.add, ...(expr.combine.sub ?? [])];
  if ("clamp" in expr) return [expr.clamp.key];
  return [...expr.ratio.num, ...expr.ratio.den];
}

/** Compile a {@link ComputeExpr} into the `compute` closure the engine runs. */
export function compileComputeExpr(expr: ComputeExpr): (values: MetricValues) => number {
  if ("sum" in expr) {
    const keys = expr.sum;
    return (v) => keys.reduce((acc, k) => acc + (v[k] ?? 0), 0);
  }
  if ("diff" in expr) {
    const [a, b] = expr.diff;
    return (v) => (v[a] ?? 0) - (v[b] ?? 0);
  }
  if ("scale" in expr) {
    const [key, factor] = expr.scale;
    return (v) => (v[key] ?? 0) * factor;
  }
  const sumOf = (keys: string[], v: MetricValues) => keys.reduce((acc, k) => acc + (v[k] ?? 0), 0);
  if ("combine" in expr) {
    const { add, sub = [] } = expr.combine;
    return (v) => sumOf(add, v) - sumOf(sub, v);
  }
  if ("clamp" in expr) {
    const { key, min, max } = expr.clamp;
    return (v) => {
      let x = v[key] ?? 0;
      if (min !== undefined) x = Math.max(min, x);
      if (max !== undefined) x = Math.min(max, x);
      return x;
    };
  }
  const { num, den, scale = 1 } = expr.ratio;
  return (v) => {
    const d = sumOf(den, v);
    return d === 0 ? 0 : (sumOf(num, v) / d) * scale;
  };
}

function toMetricDef(m: MetricDataDef): MetricDef {
  // `computeAggregate` is author-time only; resolution strips it, but drop it
  // here too so a stray token can never leak into the runtime metric.
  const { computeExpr, computeAggregate: _computeAggregate, ...rest } = m;
  return computeExpr
    ? {
        ...rest,
        compute: compileComputeExpr(computeExpr),
        computeInputs: computeExprInputs(computeExpr),
      }
    : rest;
}

/**
 * Turn serializable {@link ProfileData} into the runtime {@link InverterProfile}.
 * First-party packages may pass a code {@link SimulateFn} (data profiles omit it
 * and fall back to the simulator's generic synthesis).
 */
export function hydrateProfile(
  data: ProfileData,
  opts?: { simulate?: SimulateFn },
): InverterProfile {
  return {
    id: data.id,
    name: data.name,
    manufacturer: data.manufacturer,
    metrics: data.metrics.map(toMetricDef),
    simulate: opts?.simulate,
  };
}
