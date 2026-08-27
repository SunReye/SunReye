import type { CanonicalRole } from "./roles";
import { ROLE_CATALOG } from "./roles";
import { bindingFor, declarationsOf } from "./profile-data";
import type {
  AggregateExpr,
  AggregateMatch,
  ComputeExpr,
  ControlExpr,
  MetricDataDef,
  ProfileData,
  TopicToKey,
} from "./profile-data";
import type {
  Binding,
  MetricAccess,
  MetricFlow,
  MetricKind,
  MetricRange,
  MetricStorage,
  ProfileDeclarations,
  RegisterType,
} from "./types";

/**
 * Authoring SDK for inverter profiles. `metric()` mirrors the terse register-map
 * shape (key derived from the topic, sensible defaults) but is *role-aware*:
 * once you pick a {@link CanonicalRole}, the type system demands the companions
 * that role requires (a 1-based `index` for indexed roles, `enumLabels` for
 * enum/status roles, `access: "rw"` for writable settings). Mapping the wrong
 * shape fails to compile rather than producing a silently broken manifest.
 */

/** Fields every metric shares, independent of role. */
export interface BaseMetricOpts {
  label: string;
  group: string;
  /** Single address, `[low, high]` for `U_DWORD`, N words for `RAW`. Omit for computed. */
  addr?: number | number[];
  /**
   * RFC 6901 JSON pointer into the device's HTTP response, e.g.
   * `/em:0/total_act_power`. Mutually exclusive with {@link addr}: a value
   * cannot live in a register and in a JSON body at once.
   */
  pointer?: string;
  type?: RegisterType;
  unit?: string | null;
  scale?: number;
  /** Post-scale additive offset (`raw * scale + offset`), e.g. `-100` for +1000-encoded temps. */
  offset?: number;
  access?: MetricAccess;
  /**
   * Declarative derived value (replaces a code `compute`). Either a concrete
   * {@link ComputeExpr} or a deferred {@link sumOf} aggregate, which resolves to
   * a concrete expr against the final metric set at build time.
   */
  computeExpr?: ComputeExpr | AggregateExpr;
  kind?: MetricKind;
  /** Overrides the storage class derived from the resolved kind. */
  storage?: MetricStorage;
  /**
   * Minimum change worth persisting, in this metric's own unit — set it where
   * the register is noisy. Absent (the default) stores every change.
   */
  deadband?: number;
  range?: MetricRange;
  flow?: MetricFlow;
}

/**
 * The {@link ROLE_CATALOG} entry for one role.
 *
 * @internal
 */
export type RoleEntry<R extends CanonicalRole> = (typeof ROLE_CATALOG)[R];

/**
 * Companions a role forces, read from its {@link ROLE_CATALOG} shape flags.
 *
 * @internal
 */
export type RoleRequirements<R extends CanonicalRole> = (RoleEntry<R> extends { indexed: true }
  ? { index: number }
  : { index?: number }) &
  (RoleEntry<R> extends { needsEnumLabels: true }
    ? { enumLabels: Record<number, string> }
    : { enumLabels?: Record<number, string> }) &
  (RoleEntry<R> extends { writable: true } ? { access: "rw" } : object);

/** Options when a role is supplied: base + the role + its required companions. */
export type RoledMetricOpts = {
  [R in CanonicalRole]: BaseMetricOpts & { role: R } & RoleRequirements<R>;
}[CanonicalRole];

/** Options for a plain, unmapped metric — valid, just not rendered by role. */
export type UnroledMetricOpts = BaseMetricOpts & {
  role?: undefined;
  index?: number;
  enumLabels?: Record<number, string>;
};

export type MetricOpts = RoledMetricOpts | UnroledMetricOpts;

/** True when a `computeExpr` opt is a deferred {@link sumOf} aggregate. */
function isAggregate(expr: ComputeExpr | AggregateExpr | undefined): expr is AggregateExpr {
  return expr !== undefined && "__aggregate" in expr;
}

/**
 * Sort a `computeExpr` opt into the two mutually-exclusive slots a metric
 * carries: a concrete {@link ComputeExpr} stays in `computeExpr`, a deferred
 * aggregate goes to `computeAggregate` (resolved at build time). Setting either
 * clears the other, so restating one via a patch never leaves a stale token.
 */
function splitCompute(expr: ComputeExpr | AggregateExpr | undefined): {
  computeExpr?: ComputeExpr;
  computeAggregate?: AggregateExpr;
} {
  if (expr === undefined) return {};
  return isAggregate(expr) ? { computeAggregate: expr } : { computeExpr: expr };
}

/**
 * Declare a deferred aggregate: "sum every metric matching `match`", resolved
 * against the *final* metric set at build time rather than a hand-listed key
 * set. Write the intent once on the base — `sumOf({ role: "pv.string.power" })`
 * — and every variant that adds or drops a string re-derives the correct sum
 * automatically, no per-model patch. Fail-loud: zero matches is a build error.
 */
export function sumOf(match: AggregateMatch): AggregateExpr {
  return { __aggregate: { op: "sum", match } };
}

/**
 * A metric a builder produced: its {@link Binding} is always present, so the
 * result satisfies the runtime {@link MetricDef} without going through the
 * upcast. (On a serialized `MetricDataDef` the binding is optional — a v1
 * profile carries none.)
 */
export type BoundMetricDef = MetricDataDef & { binding: Binding };

/**
 * Build one metric. The canonical `key` is the topic with `/` → `.`. Generic on
 * the topic literal so the returned `key` is a literal type ({@link TopicToKey}):
 * profiles can derive their key union (`typeof metrics[number]["key"]`) and feed
 * it to {@link control} for autocompleted, compile-checked control targets.
 */
export function metric<const T extends string>(
  topic: T,
  opts: MetricOpts,
): BoundMetricDef & { key: TopicToKey<T> } {
  const { addr, pointer } = opts;
  if (addr !== undefined && pointer !== undefined) {
    throw new Error(`${topic}: a metric cannot have both an address and a pointer`);
  }
  const def: MetricDataDef & { key: TopicToKey<T> } = {
    // The runtime `replaceAll` produces exactly `TopicToKey<T>` by construction;
    // assert it so the literal key type survives (String#replaceAll widens to string).
    key: topic.replaceAll("/", ".") as TopicToKey<T>,
    topic,
    label: opts.label,
    unit: opts.unit ?? null,
    group: opts.group,
    type: opts.type ?? "U_WORD",
    addresses: addr === undefined ? [] : Array.isArray(addr) ? addr : [addr],
    scale: opts.scale ?? 1,
    offset: opts.offset,
    access: opts.access ?? "r",
    ...splitCompute(opts.computeExpr),
    role: opts.role,
    index: opts.index,
    kind: opts.kind,
    storage: opts.storage,
    deadband: opts.deadband,
    range: opts.range,
    enumLabels: opts.enumLabels,
    flow: opts.flow,
  };
  return { ...def, binding: bindingOf(def, pointer) };
}

/**
 * The binding for a metric being authored. A pointer states it outright, because
 * there is nothing on the metric for {@link bindingFor} to derive it from — the
 * legacy `type`/`addresses` mirror speaks only in registers.
 */
function bindingOf(def: MetricDataDef, pointer: string | undefined): Binding {
  return pointer === undefined ? bindingFor(def) : { via: "http", pointer };
}

/** Options for a composite control built by {@link control}. */
export interface ControlOpts<K extends string> {
  label: string;
  group: string;
  /** The declarative action; every `target` is constrained to a profile key `K`. */
  controlExpr: ControlExpr<K>;
  /** Labels for the control's own value (e.g. `{0:"Unlocked",1:"Locked"}`). */
  enumLabels?: Record<number, string>;
  unit?: string | null;
  kind?: MetricKind;
  /**
   * Overrides the storage class. A composite control owns no register, so the
   * derivation sends it to the config change-log; `none` keeps it off disk
   * entirely, which is usually what a snapshot toggle wants.
   */
  storage?: MetricStorage;
  /** Optional bounds; renders a capped slider and clamps writes when present. */
  range?: MetricRange;
  /** Writable by definition; defaults to `"rw"`. */
  access?: MetricAccess;
}

/**
 * Build a composite control — a writable metric with no register of its own,
 * realized by a {@link ControlExpr} over other metrics. `K` is the profile's
 * canonical key union, so `controlExpr.target` autocompletes and rejects
 * unknown keys at author time. Addressless: never read/written on the wire.
 */
export function control<const K extends string>(
  topic: string,
  opts: ControlOpts<K>,
): BoundMetricDef {
  const def: MetricDataDef = {
    key: topic.replaceAll("/", "."),
    topic,
    label: opts.label,
    unit: opts.unit ?? null,
    group: opts.group,
    type: "U_WORD",
    addresses: [],
    scale: 1,
    access: opts.access ?? "rw",
    controlExpr: opts.controlExpr,
    enumLabels: opts.enumLabels,
    kind: opts.kind,
    storage: opts.storage,
    range: opts.range,
  };
  return { ...def, binding: bindingFor(def) };
}

/**
 * Re-derive every metric's {@link MetricDataDef.binding} from its final fields.
 * Run at emit time, after overlays and aggregate resolution, so a patched
 * address or a restated compute can never leave a stale binding behind — the
 * one place addressing is stated twice is the one place it is re-synced.
 */
function bound(metrics: MetricDataDef[]): MetricDataDef[] {
  return metrics.map((m) => ({
    // An http binding is exempt, and not as a special case: re-deriving exists
    // because addressing is stated twice, and a pointer is stated once. There is
    // nothing in the mirror to re-sync it against, so carrying it through is the
    // same rule, not an exception to it.
    ...m,
    binding: m.binding?.via === "http" ? m.binding : bindingFor({ ...m, binding: undefined }),
  }));
}

/**
 * The version every authored profile is emitted at — the vocabulary this SDK
 * writes, not the oldest one the runtime still reads.
 */
const EMIT_SCHEMA_VERSION = 3 as const;

/**
 * A declarations block, or nothing at all. An emitted profile is a JSON artifact
 * that gets diffed against its own baseline, so an absent declaration must leave
 * no key behind rather than serialize as `"declares": undefined`.
 */
function declaresPart(declares: ProfileDeclarations | undefined): {
  declares?: ProfileDeclarations;
} {
  return declares ? { declares } : {};
}

/** Assemble a {@link ProfileData} from identity + a metric list, resolving any
 *  deferred {@link sumOf} aggregates against the given metrics. */
export function defineProfile(input: {
  id: string;
  name: string;
  manufacturer: string;
  version: string;
  metrics: MetricDataDef[];
  /** Hardware the metric set cannot imply — see {@link ProfileDeclarations}. */
  declares?: ProfileDeclarations;
}): ProfileData {
  const { declares, ...identity } = input;
  return {
    schemaVersion: EMIT_SCHEMA_VERSION,
    ...identity,
    ...declaresPart(declares),
    metrics: bound(
      resolveAggregates(
        input.metrics.map((m) => ({ ...m })),
        input.id,
      ),
    ),
  };
}

/**
 * Patch for one existing metric: any `metric()` field (`addr`, `scale`, `type`,
 * `unit`, `label`, `enumLabels`, …) plus a `min`/`max` shorthand that merges into
 * the metric's `range`. `role`/`index` can be restated but rarely need changing.
 */
export type MetricPatch = Partial<Omit<MetricOpts, "role">> & {
  min?: number;
  max?: number;
  role?: CanonicalRole;
  index?: number;
};

/** A brand-new metric added by an overlay: the same opts `metric(key, opts)` takes. */
export type MetricAdd = MetricOpts;

/**
 * Per-model metric overlay keyed by canonical metric key. One rule per entry:
 * - key exists in base + patch object → merge the given fields into that metric
 * - key exists in base + `null`       → remove that metric
 * - trailing `.*` wildcard + `null`   → remove every metric under the prefix
 * - key NOT in base + full definition → add a new metric (topic = key, `.`→`/`)
 *
 * Co-located in {@link defineFamily}, `K` is the base's key union so known keys
 * **autocomplete**. Because wildcards and new-metric adds are also arbitrary
 * strings, a mistyped patch/remove target can't be distinguished from an add at
 * the type level — it's caught at build/load time by the runtime guards below
 * (patch/remove of an absent key throws), not by the compiler.
 */
export type MetricsOverlay<K extends string = string> = Partial<
  Record<K | (string & {}), MetricPatch | MetricAdd | null>
>;

/**
 * Per-model tweaks. Identity (`id`) comes from the `models` record key;
 * `name`/`version`/`manufacturer` inherit from the base when omitted.
 */
export interface ModelOverrides<K extends string = string> {
  name?: string;
  version?: string;
  manufacturer?: string;
  metrics?: MetricsOverlay<K>;
  /**
   * Restated hardware declarations — a model of the same family without the
   * backup output, say. Omitted inherits the base's.
   */
  declares?: ProfileDeclarations;
}

function normalizeAddr(addr: number | number[]): number[] {
  return Array.isArray(addr) ? [...addr] : [addr];
}

/** Merge one {@link MetricPatch} into a clone of `base` (never mutates `base`). */
function applyPatch(base: MetricDataDef, patch: MetricPatch): MetricDataDef {
  const { addr, min, max, range, computeExpr, ...rest } = patch;
  const next: MetricDataDef = { ...base, ...rest };
  if (addr !== undefined) next.addresses = normalizeAddr(addr);
  if (range !== undefined) next.range = { ...range };
  if (min !== undefined || max !== undefined) {
    const cur = next.range ?? { min: 0, max: 0 };
    next.range = { min: min ?? cur.min, max: max ?? cur.max };
  }
  if (computeExpr !== undefined) {
    // A restated compute (concrete or deferred) fully replaces the base's — drop
    // both slots first so a base aggregate can't survive next to a new concrete.
    delete next.computeExpr;
    delete next.computeAggregate;
    Object.assign(next, splitCompute(computeExpr));
  }
  return next;
}

/** Keys a `null` overlay entry removes: an exact key, or a trailing-`.*` group. */
function resolveRemoval(rawKey: string, baseMetrics: MetricDataDef[], baseId: string): string[] {
  if (rawKey.endsWith(".*")) {
    const prefix = rawKey.slice(0, -2);
    const matches = baseMetrics.filter((m) => m.key === prefix || m.key.startsWith(`${prefix}.`));
    if (matches.length === 0) {
      throw new Error(`overlay wildcard "${rawKey}" matched no metrics in base "${baseId}"`);
    }
    return matches.map((m) => m.key);
  }
  if (!baseMetrics.some((m) => m.key === rawKey)) {
    throw new Error(`overlay cannot remove "${rawKey}": no such metric in base "${baseId}"`);
  }
  return [rawKey];
}

/**
 * The metric a non-`null` overlay entry yields: a patched clone of the existing
 * metric, or — for an unknown key carrying a complete definition — a new add. A
 * partial object on an unknown key is a typo'd patch target, so it throws.
 */
function resolveUpsert(
  rawKey: string,
  value: MetricPatch | MetricAdd,
  existing: MetricDataDef | undefined,
  baseId: string,
): MetricDataDef {
  if (rawKey.endsWith(".*")) {
    throw new Error(`overlay wildcard "${rawKey}" must be null (remove); got a value`);
  }
  if (existing) return applyPatch(existing, value);
  if (!value.label || !value.group) {
    throw new Error(
      `overlay cannot patch "${rawKey}": no such metric in base "${baseId}" ` +
        `(adding a metric requires a full definition with label + group)`,
    );
  }
  return metric(rawKey.replaceAll(".", "/"), value as MetricOpts);
}

/** Every target metric key a {@link ControlExpr} writes to. */
function controlRefs(expr: ControlExpr): string[] {
  return "snapshotToggle" in expr
    ? [expr.snapshotToggle.target]
    : expr.preset.writes.map((w) => w.target);
}

/** The one error shape every un-prunable reference reports. */
function refStillNeeded(metricKey: string, ref: string, why: string): never {
  throw new Error(
    `overlay removed "${ref}" but computed metric "${metricKey}" still needs it (${why}); ` +
      `patch its computeExpr or remove "${metricKey}" too`,
  );
}

/** Drop `removed` from a variadic operand list; emptying it entirely throws. */
function shrinkOperands(
  keys: string[],
  removed: Set<string>,
  metricKey: string,
  why: string,
): string[] {
  const kept = keys.filter((k) => !removed.has(k));
  if (kept.length === 0) refStillNeeded(metricKey, keys.find((k) => removed.has(k))!, why);
  return kept;
}

/** True when any of `keys` was removed — i.e. this expr needs rewriting at all. */
function anyRemoved(keys: string[], removed: Set<string>): boolean {
  return keys.some((k) => removed.has(k));
}

/**
 * The operands of a *fixed-arity* expr (`diff`, `scale`, `clamp`) plus the label
 * used when one of them was removed; `undefined` for the variadic kinds.
 */
function fixedArityOperands(
  expr: ComputeExpr,
): { refs: readonly string[]; why: string } | undefined {
  if ("diff" in expr) return { refs: expr.diff, why: "fixed-arity diff" };
  if ("scale" in expr) return { refs: [expr.scale[0]], why: "fixed-arity scale" };
  if ("clamp" in expr) return { refs: [expr.clamp.key], why: "single-key clamp" };
  return undefined;
}

/** Prune a `combine`: `add` must keep an operand, `sub` may empty out. */
function pruneCombine(
  expr: { combine: { add: string[]; sub?: string[] } },
  removed: Set<string>,
  metricKey: string,
): ComputeExpr {
  const sub = expr.combine.sub ?? [];
  if (!anyRemoved([...expr.combine.add, ...sub], removed)) return expr;
  const add = shrinkOperands(expr.combine.add, removed, metricKey, "empties combine.add");
  const keptSub = sub.filter((k) => !removed.has(k));
  return { combine: keptSub.length > 0 ? { add, sub: keptSub } : { add } };
}

/** Prune a `ratio`: both `num` and `den` must keep at least one operand. */
function pruneRatio(
  expr: { ratio: { num: string[]; den: string[]; scale?: number } },
  removed: Set<string>,
  metricKey: string,
): ComputeExpr {
  const { num, den, scale } = expr.ratio;
  if (!anyRemoved([...num, ...den], removed)) return expr;
  const keptNum = shrinkOperands(num, removed, metricKey, "empties ratio.num");
  const keptDen = shrinkOperands(den, removed, metricKey, "empties ratio.den");
  const pruned = { num: keptNum, den: keptDen };
  return { ratio: scale !== undefined ? { ...pruned, scale } : pruned };
}

/**
 * Rewrite one concrete {@link ComputeExpr} with `removed` keys dropped. A
 * removed key in a *variadic* list (`sum`, `combine.add/sub`, `ratio.num/den`)
 * is pruned — semantically identical to what the author would hand-type. A
 * removed key in a *fixed-arity* expr (`diff`, `scale`, `clamp`), or one whose removal
 * would empty a required list, throws instead: shrinking there would silently
 * change the number (e.g. an emptied `ratio.den` reads a constant 0), so we
 * refuse loudly rather than ship a wrong value. Returns a fresh expr when it
 * changes; the original (base-owned) object is never mutated.
 */
function pruneComputeExpr(expr: ComputeExpr, removed: Set<string>, metricKey: string): ComputeExpr {
  if ("sum" in expr) {
    if (!anyRemoved(expr.sum, removed)) return expr;
    return { sum: shrinkOperands(expr.sum, removed, metricKey, "empties a sum") };
  }
  if ("combine" in expr) return pruneCombine(expr, removed, metricKey);
  if ("ratio" in expr) return pruneRatio(expr, removed, metricKey);
  // Only the fixed-arity kinds are left, so this is always defined.
  const { refs, why } = fixedArityOperands(expr)!;
  const hit = refs.find((k) => removed.has(k));
  if (hit !== undefined) refStillNeeded(metricKey, hit, why);
  return expr;
}

/**
 * After an overlay removes metrics, reconcile every survivor that referenced a
 * removed key: prune variadic compute lists in place, throw on the cases that
 * can't shrink safely (fixed-arity exprs, emptied required lists, control
 * targets). Operates on the overlay's own clones, so the base is untouched.
 */
function pruneRemovedRefs(metrics: MetricDataDef[], removed: Set<string>): void {
  if (removed.size === 0) return;
  for (const m of metrics) {
    if (m.controlExpr) {
      const hit = controlRefs(m.controlExpr).find((ref) => removed.has(ref));
      if (hit !== undefined) {
        throw new Error(
          `overlay removed "${hit}" but control "${m.key}" targets it; ` +
            `patch its controlExpr or remove "${m.key}" too`,
        );
      }
    }
    if (m.computeExpr) m.computeExpr = pruneComputeExpr(m.computeExpr, removed, m.key);
  }
}

/** Does `m` fall in an aggregate's selection (by role, or key-prefix subtree)? */
function matchesAggregate(m: MetricDataDef, match: AggregateMatch): boolean {
  if ("role" in match) return m.role === match.role;
  return m.key === match.keyPrefix || m.key.startsWith(`${match.keyPrefix}.`);
}

function describeMatch(match: AggregateMatch): string {
  return "role" in match ? `role "${match.role}"` : `keyPrefix "${match.keyPrefix}"`;
}

/**
 * Resolve every deferred {@link sumOf} aggregate against the *final* metric set,
 * mutating each carrier in place: gather the matching keys (excluding itself),
 * write a concrete `{ sum }`, and drop the token. An aggregate that matches
 * nothing throws — a variant never silently ships an empty sum. Mutates the
 * passed clones only; returns the same array for chaining.
 */
function resolveAggregates(metrics: MetricDataDef[], profileId: string): MetricDataDef[] {
  for (const m of metrics) {
    const agg = m.computeAggregate;
    if (!agg) continue;
    const keys = metrics
      .filter((x) => x.key !== m.key && matchesAggregate(x, agg.__aggregate.match))
      .map((x) => x.key);
    if (keys.length === 0) {
      throw new Error(
        `aggregate on "${m.key}" in profile "${profileId}" matched no metrics ` +
          `(${describeMatch(agg.__aggregate.match)})`,
      );
    }
    delete m.computeAggregate;
    // Only `sum` exists today; the op is carried for forward compatibility.
    m.computeExpr = { sum: keys };
  }
  return metrics;
}

/**
 * Base keys the overlay's `null` entries delete, with every trailing-`.*`
 * wildcard already expanded to the subtree it matches.
 */
function collectRemovals(
  overlay: MetricsOverlay,
  baseMetrics: MetricDataDef[],
  baseId: string,
): Set<string> {
  const removed = new Set<string>();
  for (const [rawKey, value] of Object.entries(overlay)) {
    if (value !== null) continue;
    for (const key of resolveRemoval(rawKey, baseMetrics, baseId)) removed.add(key);
  }
  return removed;
}

/** The two ways a value-carrying overlay entry lands: over a base metric, or beside it. */
interface OverlayUpserts {
  /** Derived replacements for metrics the base already has, keyed by base key. */
  patched: Map<string, MetricDataDef>;
  /** Metrics the overlay introduces, in overlay order. */
  added: MetricDataDef[];
}

/**
 * Resolve the overlay's value-carrying entries into patches of existing base
 * metrics and brand-new additions. An entry set to `undefined` is skipped, so an
 * optional overlay key spread in as `undefined` reads as "not mentioned".
 */
function collectUpserts(
  overlay: MetricsOverlay,
  baseMetrics: MetricDataDef[],
  baseId: string,
): OverlayUpserts {
  const byKey = new Map(baseMetrics.map((m) => [m.key, m]));
  const patched = new Map<string, MetricDataDef>();
  const added: MetricDataDef[] = [];
  for (const [rawKey, value] of Object.entries(overlay)) {
    if (value === null || value === undefined) continue;
    const existing = byKey.get(rawKey);
    const derived = resolveUpsert(rawKey, value, existing, baseId);
    if (existing) patched.set(rawKey, derived);
    else added.push(derived);
  }
  return { patched, added };
}

/** Apply a keyed overlay over a clone of `baseMetrics`, returning fresh metrics. */
function deriveMetrics(
  baseMetrics: MetricDataDef[],
  overlay: MetricsOverlay,
  baseId: string,
): MetricDataDef[] {
  const removed = collectRemovals(overlay, baseMetrics, baseId);
  const { patched, added } = collectUpserts(overlay, baseMetrics, baseId);
  const kept = baseMetrics
    .filter((m) => !removed.has(m.key))
    .map((m) => patched.get(m.key) ?? { ...m });
  const result = [...kept, ...added];
  pruneRemovedRefs(result, removed);
  return result;
}

/**
 * Derive one self-contained profile from an existing `base` by overlaying
 * per-model tweaks. The low-level primitive behind {@link defineFamily}; use it
 * directly to specialize an imported or third-party {@link ProfileData}. Never
 * mutates `base`, so one base can spawn many models.
 */
export function defineVariant(
  base: ProfileData,
  overrides: ModelOverrides & { id: string },
): ProfileData {
  // Overlay first (removing metrics + pruning explicit refs), then resolve
  // deferred aggregates against what survives — so a dropped string re-derives
  // the correct sum on its own.
  const metrics = resolveAggregates(
    overrides.metrics
      ? deriveMetrics(base.metrics, overrides.metrics, base.id)
      : base.metrics.map((m) => ({ ...m })),
    overrides.id,
  );
  return {
    schemaVersion: EMIT_SCHEMA_VERSION,
    id: overrides.id,
    name: overrides.name ?? base.name,
    manufacturer: overrides.manufacturer ?? base.manufacturer,
    version: overrides.version ?? base.version,
    // `declarationsOf` rather than `base.declares`: a legacy base states its
    // backup output through its `load.*` roles, and the variant is emitted at a
    // version where that is no longer read.
    ...declaresPart(overrides.declares ?? declarationsOf(base)),
    metrics: bound(metrics),
  };
}

/**
 * Co-located family: the shared base identity + register map, plus `models`
 * keyed by profile id. Returns the generic base profile first, then one
 * self-contained {@link ProfileData} per model. Generic over the metric list so
 * overlay keys are typed against the base (autocomplete + compile-time typos).
 */
export function defineFamily<const M extends readonly MetricDataDef[]>(def: {
  id: string;
  name: string;
  manufacturer: string;
  version: string;
  metrics: M;
  /** The family's hardware declarations; a model may restate them. */
  declares?: ProfileDeclarations;
  models: Record<string, ModelOverrides<M[number]["key"]>>;
}): ProfileData[] {
  // Keep the base metrics UNRESOLVED (aggregate tokens intact) and derive every
  // profile — the emitted base included — through defineVariant. Resolving the
  // base up front (via defineProfile) would bake in the base's own key list, so
  // a model that drops a string could no longer self-heal its aggregates.
  const unresolvedBase: ProfileData = {
    schemaVersion: EMIT_SCHEMA_VERSION,
    id: def.id,
    name: def.name,
    manufacturer: def.manufacturer,
    version: def.version,
    ...declaresPart(def.declares),
    metrics: def.metrics.map((m) => ({ ...m })),
  };
  const base = defineVariant(unresolvedBase, { id: def.id });
  const models = Object.entries(def.models).map(([id, o]) =>
    defineVariant(unresolvedBase, { id, ...o }),
  );
  return [base, ...models];
}
