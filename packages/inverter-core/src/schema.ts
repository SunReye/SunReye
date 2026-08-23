import { z } from "zod";

import { ROLE_CATALOG, ROLE_NAMES, type RoleSpec } from "./roles";
import { bindingFor, type ComputeExpr, type ControlExpr, type ProfileData } from "./profile-data";
import type { Binding } from "./types";

/**
 * Strict runtime validator for {@link ProfileData}. This is the single gate for
 * every ingested profile — the SDK at author time, the install path at download
 * time, and the server at boot load. Because a profile is pure data, the whole
 * threat surface is malformed data, and it is contained here: a bad profile
 * fails validation or yields nothing — it can never execute code.
 *
 * Beyond structural checks it runs semantic lints a plain schema can't express
 * (duplicate keys/addresses, register-width mismatches, role-shape rules from
 * {@link ROLE_CATALOG}, and forward references in `computeExpr`).
 */

const registerTypeSchema = z.enum(["U_WORD", "S_WORD", "U_DWORD", "RAW"]);

const computeExprSchema = z.union([
  z.strictObject({ sum: z.array(z.string().min(1)).min(1) }),
  z.strictObject({ diff: z.tuple([z.string().min(1), z.string().min(1)]) }),
  z.strictObject({ scale: z.tuple([z.string().min(1), z.number()]) }),
  z.strictObject({
    combine: z.strictObject({
      add: z.array(z.string().min(1)).min(1),
      sub: z.array(z.string().min(1)).optional(),
    }),
  }),
  z.strictObject({
    ratio: z.strictObject({
      num: z.array(z.string().min(1)).min(1),
      den: z.array(z.string().min(1)).min(1),
      scale: z.number().optional(),
    }),
  }),
  z
    .strictObject({
      clamp: z.strictObject({
        key: z.string().min(1),
        min: z.number().optional(),
        max: z.number().optional(),
      }),
    })
    // A clamp with neither bound is a no-op (identity) — reject it so the
    // author states at least one bound and the intent is explicit.
    .refine((e) => e.clamp.min !== undefined || e.clamp.max !== undefined, {
      message: "clamp requires at least one of min or max",
      path: ["clamp"],
    }),
]);

const controlExprSchema = z.union([
  z.strictObject({
    snapshotToggle: z.strictObject({ target: z.string().min(1), lockedValue: z.number() }),
  }),
  z.strictObject({
    preset: z.strictObject({
      writes: z.array(z.strictObject({ target: z.string().min(1), value: z.number() })).min(1),
    }),
  }),
]);

/**
 * The tagged binding. A `via` the runtime does not implement fails *here*, when
 * the profile is parsed — the point of tagging the union rather than probing
 * optional fields at read time.
 */
/**
 * RFC 6901 JSON pointer, minus the empty one. `""` is legal in the RFC and means
 * the whole document — never what a metric wants, and it would silently address
 * an object where a number is expected. Otherwise: one or more `/`-prefixed
 * reference tokens, in which the only escapes are `~0` (a literal `~`) and `~1`
 * (a literal `/`), so a dangling or undefined `~x` is a typo, not a token.
 */
const jsonPointerSchema = z
  .string()
  .regex(/^(?:\/(?:[^~]|~[01])*)+$/, "pointer must be a non-empty RFC 6901 JSON pointer");

const bindingSchema = z.discriminatedUnion("via", [
  z.strictObject({
    via: z.literal("modbus"),
    addr: z.array(z.number().int().min(0).max(65535)),
    type: registerTypeSchema,
  }),
  z.strictObject({ via: z.literal("http"), pointer: jsonPointerSchema }),
  z.strictObject({ via: z.literal("compute"), expr: computeExprSchema }),
  z.strictObject({ via: z.literal("control"), expr: controlExprSchema }),
]);

const metricDataSchema = z.strictObject({
  key: z.string().min(1),
  topic: z.string().min(1),
  label: z.string().min(1),
  unit: z.string().nullable(),
  group: z.string().min(1),
  type: registerTypeSchema,
  addresses: z.array(z.number().int().min(0).max(65535)),
  scale: z.number(),
  offset: z.number().optional(),
  access: z.enum(["r", "rw"]),
  binding: bindingSchema.optional(),
  computeExpr: computeExprSchema.optional(),
  controlExpr: controlExprSchema.optional(),
  role: z.enum(ROLE_NAMES).optional(),
  index: z.number().int().positive().optional(),
  kind: z.enum(["measurement", "cumulative", "status", "setting"]).optional(),
  range: z.strictObject({ min: z.number(), max: z.number() }).optional(),
  // JSON object keys are strings; enum keys must be integer-like.
  enumLabels: z.record(z.string().regex(/^-?\d+$/), z.string()).optional(),
  flow: z.strictObject({ positive: z.string(), negative: z.string() }).optional(),
});

/** A semantic-lint failure: which field of a metric, and why. */
interface FieldIssue {
  field: string;
  message: string;
}

/** Addresses on a metric that owns no register — one claim too many. */
function strayAddresses(m: z.infer<typeof metricDataSchema>, what: string): FieldIssue[] {
  return m.addresses.length === 0
    ? []
    : [{ field: "addresses", message: `${what} must have no addresses` }];
}

/**
 * The arms that own no register: an http metric addressed by pointer, a
 * composite control, a computed value. Their only width rule is that they claim
 * no addresses — for an http metric, `type`/`addresses` are the neutral seed the
 * upcast filled in, and addresses beside a pointer would be two conflicting
 * claims about where the value lives. `null` means "this metric does own
 * registers", so {@link widthIssues} should go on and count them.
 */
function addresslessIssues(m: z.infer<typeof metricDataSchema>): FieldIssue[] | null {
  if (m.binding?.via === "http") return strayAddresses(m, "http metric");
  if (m.controlExpr) {
    const alsoComputed: FieldIssue[] = m.computeExpr
      ? [{ field: "controlExpr", message: "metric cannot be both a control and computed" }]
      : [];
    return [...alsoComputed, ...strayAddresses(m, "control metric")];
  }
  if (m.computeExpr) return strayAddresses(m, "computed metric");
  return null;
}

/**
 * Register-width rules a plain schema can't express: the addressless arms own no
 * register at all, `RAW` needs at least one word, and the fixed-width types need
 * exactly the count their encoding implies.
 */
function widthIssues(m: z.infer<typeof metricDataSchema>): FieldIssue[] {
  const addressless = addresslessIssues(m);
  if (addressless) return addressless;
  if (m.type === "RAW") {
    return m.addresses.length >= 1
      ? []
      : [{ field: "addresses", message: "RAW metric needs at least one address" }];
  }
  const want = m.type === "U_DWORD" ? 2 : 1;
  return m.addresses.length === want
    ? []
    : [
        {
          field: "addresses",
          message: `${m.type} needs ${want} address(es), got ${m.addresses.length}`,
        },
      ];
}

function computeRefs(expr: ComputeExpr): string[] {
  if ("sum" in expr) return expr.sum;
  if ("diff" in expr) return expr.diff;
  if ("scale" in expr) return [expr.scale[0]];
  if ("combine" in expr) return [...expr.combine.add, ...(expr.combine.sub ?? [])];
  if ("clamp" in expr) return [expr.clamp.key];
  return [...expr.ratio.num, ...expr.ratio.den];
}

/** Every target metric key a control writes to. */
function controlRefs(expr: ControlExpr): string[] {
  if ("snapshotToggle" in expr) return [expr.snapshotToggle.target];
  return expr.preset.writes.map((w) => w.target);
}

/**
 * A binding the legacy `type`/`addresses`/`computeExpr`/`controlExpr` mirror can
 * represent. `http` cannot be one: the mirror speaks in registers, and a pointer
 * is not one — which is why {@link bindingIssues} never compares it.
 */
type MirrorBinding = Exclude<Binding, { via: "http" }>;

/** Structural equality of two bindings (key order and identity aside). */
function sameBinding(a: MirrorBinding, b: MirrorBinding): boolean {
  if (a.via !== b.via) return false;
  if (a.via === "modbus") {
    const other = b as Extract<Binding, { via: "modbus" }>;
    return (
      a.type === other.type &&
      a.addr.length === other.addr.length &&
      a.addr.every((x, i) => x === other.addr[i])
    );
  }
  return (
    JSON.stringify(a.expr) === JSON.stringify((b as Extract<Binding, { via: "compute" }>).expr)
  );
}

/**
 * Per-version binding rules: v1 metrics carry none (the upcast happens on load,
 * one-way), v2 metrics must carry one that agrees with the legacy mirror the
 * upcast fills in. A disagreement means an author patched an address without
 * re-deriving the binding — silently reading the wrong register otherwise.
 */
function bindingIssues(m: z.infer<typeof metricDataSchema>, version: number): FieldIssue[] {
  if (version === 1) {
    return m.binding ? [{ field: "binding", message: "binding requires schemaVersion 2" }] : [];
  }
  if (!m.binding) {
    return [{ field: "binding", message: "schemaVersion 2 requires a binding" }];
  }
  // Nothing to disagree with: the mirror can only describe registers, and an
  // http metric has none. The equivalent check — that it claims no addressing
  // outside its pointer — is `widthIssues`.
  if (m.binding.via === "http") return [];
  // `bindingFor` returns `m.binding` when present, so passing `m` straight in
  // compared the binding to itself and this arm could never fire. Derive from the
  // mirror alone — that is the thing we are checking it against.
  // `MirrorBinding` by construction: with `binding` removed, `bindingFor` reads
  // only the mirror fields, whose three arms are exactly the ones it can express.
  const fromMirror = bindingFor({
    ...(m as Parameters<typeof bindingFor>[0]),
    binding: undefined,
  }) as MirrorBinding;
  return sameBinding(m.binding, fromMirror)
    ? []
    : [{ field: "binding", message: "binding disagrees with type/addresses" }];
}

/**
 * A `schemaVersion: 2` profile states its addressing only in `binding`, so fill
 * the legacy `type`/`addresses`/`computeExpr`/`controlExpr` mirror from it before
 * validation — every semantic lint below (widths, duplicate addresses, compute
 * references) then runs unchanged on either version. Explicit fields win, so a
 * profile that carries both is checked for agreement rather than overwritten.
 */
function fillLegacyMirror(metric: unknown): unknown {
  if (typeof metric !== "object" || metric === null) return metric;
  const binding = (metric as { binding?: unknown }).binding;
  if (typeof binding !== "object" || binding === null) return metric;
  const b = binding as { via?: unknown; addr?: unknown; type?: unknown; expr?: unknown };
  const mirror: Record<string, unknown> = { type: "U_WORD", addresses: [] };
  if (b.via === "modbus") Object.assign(mirror, { type: b.type, addresses: b.addr });
  if (b.via === "compute") mirror.computeExpr = b.expr;
  if (b.via === "control") mirror.controlExpr = b.expr;
  return { ...mirror, ...metric };
}

function upcastForValidation(input: unknown): unknown {
  if (typeof input !== "object" || input === null) return input;
  const data = input as { schemaVersion?: unknown; metrics?: unknown };
  if (data.schemaVersion !== 2 || !Array.isArray(data.metrics)) return input;
  return { ...data, metrics: data.metrics.map(fillLegacyMirror) };
}

const coreProfileSchema = z
  .strictObject({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "id must be a lowercase slug"),
    name: z.string().min(1),
    manufacturer: z.string().min(1),
    version: z.string().min(1),
    metrics: z.array(metricDataSchema).min(1),
  })
  .superRefine((data, ctx) => {
    const { metrics } = data;
    const at = (i: number, field: string, message: string) =>
      ctx.addIssue({ code: "custom", path: ["metrics", i, field], message });

    // --- duplicate keys ---
    const seenKey = new Set<string>();
    metrics.forEach((m, i) => {
      if (seenKey.has(m.key)) at(i, "key", `duplicate metric key "${m.key}"`);
      seenKey.add(m.key);
    });

    // --- duplicate wire addresses (computed + control metrics carry none) ---
    const owner = new Map<number, string>();
    metrics.forEach((m, i) => {
      if (m.computeExpr || m.controlExpr) return;
      for (const a of m.addresses) {
        const prev = owner.get(a);
        if (prev !== undefined) at(i, "addresses", `address ${a} already used by "${prev}"`);
        else owner.set(a, m.key);
      }
    });

    // --- register width matches type ---
    metrics.forEach((m, i) => {
      for (const issue of widthIssues(m)) at(i, issue.field, issue.message);
    });

    // --- the binding matches the schema version (and the mirror) ---
    metrics.forEach((m, i) => {
      for (const issue of bindingIssues(m, data.schemaVersion)) at(i, issue.field, issue.message);
    });

    // --- role-shape rules from the catalog ---
    metrics.forEach((m, i) => {
      if (!m.role) return;
      const spec: RoleSpec = ROLE_CATALOG[m.role];
      if (spec.indexed && m.index === undefined) {
        at(i, "index", `role "${m.role}" is indexed and requires a 1-based index`);
      }
      if (spec.needsEnumLabels && (!m.enumLabels || Object.keys(m.enumLabels).length === 0)) {
        at(i, "enumLabels", `role "${m.role}" requires enumLabels`);
      }
      if (spec.writable && m.access !== "rw") {
        at(i, "access", `role "${m.role}" is a control and requires access "rw"`);
      }
    });

    // --- computeExpr references must resolve, and never forward-ref a computed metric ---
    const posByKey = new Map(metrics.map((m, i) => [m.key, i] as const));
    const computed = new Set(metrics.filter((m) => m.computeExpr).map((m) => m.key));
    metrics.forEach((m, i) => {
      if (!m.computeExpr) return;
      for (const ref of computeRefs(m.computeExpr)) {
        const pos = posByKey.get(ref);
        if (pos === undefined) {
          at(i, "computeExpr", `references unknown metric key "${ref}"`);
        } else if (computed.has(ref) && pos >= i) {
          at(i, "computeExpr", `references computed metric "${ref}" not defined earlier`);
        }
      }
    });

    // --- controlExpr targets must resolve to a writable, non-control metric ---
    const byKey = new Map(metrics.map((m) => [m.key, m] as const));
    metrics.forEach((m, i) => {
      if (!m.controlExpr) return;
      for (const ref of controlRefs(m.controlExpr)) {
        const target = byKey.get(ref);
        if (!target) at(i, "controlExpr", `references unknown metric key "${ref}"`);
        else if (target.access !== "rw") at(i, "controlExpr", `target "${ref}" is not writable`);
        else if (target.controlExpr)
          at(i, "controlExpr", `target "${ref}" is itself a control (no chaining)`);
      }
    });
  });

/**
 * Strict validator for either schema version. A `schemaVersion: 2` profile has
 * its legacy mirror filled in first, so the parsed value is the same in-memory
 * shape a v1 profile yields plus its `binding`.
 */
export const profileDataSchema = z.preprocess(upcastForValidation, coreProfileSchema);

/** Validate untrusted input and return typed {@link ProfileData} (throws on failure). */
export function parseProfileData(input: unknown): ProfileData {
  return profileDataSchema.parse(input) as ProfileData;
}

/** Non-throwing variant for UI/CLI paths that want to render the issues. */
export function safeParseProfileData(input: unknown) {
  return profileDataSchema.safeParse(input);
}
