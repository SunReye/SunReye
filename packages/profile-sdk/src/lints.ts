import { hasResolvableKind, resolveKind, ROLE_CATALOG } from "@SunReye/inverter-core";
import type { MetricDataDef, ProfileData } from "@SunReye/inverter-core";

/**
 * Semantic lints — physical-plausibility checks the schema cannot express.
 *
 * `packages/inverter-core/src/schema.ts` already enforces structure (duplicate
 * keys and addresses, register width vs. type, role shape, reference
 * resolution). What it cannot know is whether the *numbers* make sense: a
 * percentage with no bounds, a lifetime counter in a signed register, a
 * temperature missing the vendor's +1000 offset. Each rule below is a pure
 * function over one metric and each one has cost a real profile a real bug.
 *
 * Every rule must be conservative: an author who ignores a warning stops
 * reading them, so a rule fires only when the shape is wrong, never when it is
 * merely unusual (a negative `scale` is a legitimate sign flip; an explicit
 * `offset: 0` is a decision, not an omission).
 */

/** Rule ids, so callers can filter/aggregate without matching on prose. */
export const LINT_RULES = [
  "percent-without-range",
  "signed-lifetime-counter",
  "cumulative-negative-range",
  "temperature-missing-offset",
  "enum-labels-gap",
  "zero-scale",
] as const;

export type LintRule = (typeof LINT_RULES)[number];

export interface LintFinding {
  /** Metric key the finding is about. */
  key: string;
  rule: LintRule;
  /** One-line, actionable message; always names the offending value. */
  message: string;
}

/** The role catalog's conventional unit for a metric's role, if it maps one. */
function roleUnitHint(m: MetricDataDef): string | undefined {
  if (!m.role) return undefined;
  return (ROLE_CATALOG[m.role] as { unitHint?: string }).unitHint;
}

/** The metric's kind, resolved the same way the runtime resolves it. */
function kindOf(m: MetricDataDef): string | undefined {
  if (m.kind) return m.kind;
  // `resolveKind` warns (once per key) on an unresolvable metric; that case has
  // its own lint, so don't provoke a duplicate diagnostic here.
  return hasResolvableKind(m) ? resolveKind(m) : undefined;
}

/**
 * A percentage — by unit or by its role's conventional unit — with no `range`.
 * The clamp cannot fire and a gauge has nothing to scale against, so a wild
 * register reads as 6553% instead of being caught.
 */
function percentWithoutRange(m: MetricDataDef): LintFinding | undefined {
  if (m.range) return undefined;
  if (m.unit !== "%" && roleUnitHint(m) !== "%") return undefined;
  return {
    key: m.key,
    rule: "percent-without-range",
    message:
      `${m.key}: a "%" metric with no \`range\` — clamping cannot fire and a gauge ` +
      "cannot scale. Add `range: { min: 0, max: 100 }`.",
  };
}

/** A kWh lifetime/daily counter in a signed 16-bit register. */
function signedLifetimeCounter(m: MetricDataDef): LintFinding | undefined {
  if (m.unit !== "kWh" || m.type !== "S_WORD") return undefined;
  return {
    key: m.key,
    rule: "signed-lifetime-counter",
    message:
      `${m.key}: a "kWh" counter stored as S_WORD — an energy total that can read ` +
      "negative is almost always the wrong register type (expected U_WORD/U_DWORD).",
  };
}

/** A cumulative metric whose declared range admits a negative value. */
function cumulativeNegativeRange(m: MetricDataDef): LintFinding | undefined {
  if (m.range === undefined || m.range.min >= 0) return undefined;
  if (kindOf(m) !== "cumulative") return undefined;
  return {
    key: m.key,
    rule: "cumulative-negative-range",
    message:
      `${m.key}: a cumulative metric with \`range.min\` of ${m.range.min} — a monotonic ` +
      "counter cannot go negative; a negative floor hides a decode error as data.",
  };
}

/** True for a metric that reads a temperature (by unit, or by its role). */
function isTemperature(m: MetricDataDef): boolean {
  return m.unit === "°C" || m.unit === "°F" || (m.role?.includes("temperature") ?? false);
}

/**
 * A 0.1-scaled temperature with no `offset`. `types.ts` documents the trap: the
 * common vendor encoding is `register = °C × 10 + 1000`, which needs
 * `scale: 0.1` **and** `offset: -100`. Scaling alone reports ~100 °C at idle.
 */
function temperatureMissingOffset(m: MetricDataDef): LintFinding | undefined {
  if (!isTemperature(m) || m.scale !== 0.1 || m.offset !== undefined) return undefined;
  return {
    key: m.key,
    rule: "temperature-missing-offset",
    message:
      `${m.key}: a temperature with \`scale: 0.1\` and no \`offset\` — if the register is ` +
      "the usual °C×10 + 1000 encoding it needs `offset: -100`. Set `offset: 0` " +
      "explicitly if the raw value really is unbiased.",
  };
}

/** Values with no label strictly inside an enum's own numeric span. */
function enumLabelGaps(m: MetricDataDef): number[] {
  const values = Object.keys(m.enumLabels ?? {})
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (values.length < 2) return [];
  const labelled = new Set(values);
  const gaps: number[] = [];
  for (let v = values[0]!; v < values[values.length - 1]!; v++) {
    if (!labelled.has(v)) gaps.push(v);
  }
  return gaps;
}

/**
 * An enum with holes across its own range. Either a value was forgotten (the UI
 * then renders a bare number for a state the inverter really reports) or the
 * register is a bitfield and should not be a `status` enum at all.
 */
function enumLabelsGap(m: MetricDataDef): LintFinding | undefined {
  const gaps = enumLabelGaps(m);
  if (gaps.length === 0) return undefined;
  return {
    key: m.key,
    rule: "enum-labels-gap",
    message:
      `${m.key}: \`enumLabels\` has no label for ${gaps.join(", ")} inside its own range — ` +
      "add the missing state(s), or model a bitfield as something other than an enum.",
  };
}

/** `scale: 0` — every reading decodes to zero, silently. */
function zeroScale(m: MetricDataDef): LintFinding | undefined {
  if (m.scale !== 0) return undefined;
  return {
    key: m.key,
    rule: "zero-scale",
    message: `${m.key}: \`scale: 0\` zeroes every reading. Use 1 for an unscaled register.`,
  };
}

/** Rule order inside one metric; the caller sees metrics in profile order. */
const RULES: ((m: MetricDataDef) => LintFinding | undefined)[] = [
  percentWithoutRange,
  signedLifetimeCounter,
  cumulativeNegativeRange,
  temperatureMissingOffset,
  enumLabelsGap,
  zeroScale,
];

/**
 * Run every semantic lint over a profile, in metric order then rule order.
 * Pure — no I/O, no throwing: `profile validate` prints these as warnings and
 * `--strict` turns them into a gate.
 */
export function semanticLints(data: ProfileData): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const m of data.metrics) {
    for (const rule of RULES) {
      const finding = rule(m);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}
