import { z } from "zod";

import { ROLE_CATALOG, ROLE_NAMES, type RoleSpec } from "./roles";
import type { ComputeExpr, ControlExpr, ProfileData } from "./profile-data";

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

/**
 * Register-width rules a plain schema can't express: controls and computed
 * metrics own no register at all, `RAW` needs at least one word, and the
 * fixed-width types need exactly the count their encoding implies. A metric that
 * is *both* a control and computed reports that plus any stray addresses.
 */
function widthIssues(m: z.infer<typeof metricDataSchema>): FieldIssue[] {
  const stray = (what: string): FieldIssue[] =>
    m.addresses.length === 0
      ? []
      : [{ field: "addresses", message: `${what} must have no addresses` }];

  if (m.controlExpr) {
    const alsoComputed: FieldIssue[] = m.computeExpr
      ? [{ field: "controlExpr", message: "metric cannot be both a control and computed" }]
      : [];
    return [...alsoComputed, ...stray("control metric")];
  }
  if (m.computeExpr) return stray("computed metric");
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

export const profileDataSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
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

/** Validate untrusted input and return typed {@link ProfileData} (throws on failure). */
export function parseProfileData(input: unknown): ProfileData {
  return profileDataSchema.parse(input) as ProfileData;
}

/** Non-throwing variant for UI/CLI paths that want to render the issues. */
export function safeParseProfileData(input: unknown) {
  return profileDataSchema.safeParse(input);
}
