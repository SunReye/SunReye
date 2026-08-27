import {
  applyComputed,
  tryGetProfile,
  decode,
  type InverterProfile,
  type MetricValues,
} from "@SunReye/inverter-core";
import { z } from "zod";

/**
 * A golden register capture: the raw words a real device answered, plus the
 * engineering values those words must decode to. Committed next to a profile it
 * becomes a permanent, hardware-free regression test for the highest-risk edit
 * class there is — a changed `scale`, `offset` or address.
 */
export const captureSchema = z
  .object({
    /** Profile id the capture was taken from. */
    profile: z.string().min(1),
    /** Raw 16-bit words keyed by absolute decimal register address. */
    registers: z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(0xffff)),
    /** Expected engineering values, keyed by metric key. */
    expect: z.record(z.string().min(1), z.number()),
    /**
     * Absolute comparison tolerance. Defaults to {@link DEFAULT_TOLERANCE}.
     */
    tolerance: z.number().positive().optional(),
  })
  .strict();

export type Capture = z.infer<typeof captureSchema>;

/**
 * Default absolute tolerance for comparing a decoded value to its expectation.
 *
 * `raw * scale + offset` is not exact in IEEE-754 — `1001 * 0.1 - 100` is
 * 0.10000000000000853, so `===` against a hand-written 0.1 would fail on a
 * perfectly correct profile. 1e-6 absorbs that (double rounding on these
 * magnitudes is ~1e-14) while staying far below the smallest quantum any
 * profile can express: the finest `scale` in use is 0.001, so a one-LSB decode
 * error is 1000x the tolerance and still fails loudly.
 */
export const DEFAULT_TOLERANCE = 1e-6;

export interface Expectation {
  key: string;
  expected: number;
  /** `undefined` when the metric did not decode (absent register / RAW). */
  actual: number | undefined;
}

export interface MissingRegisters {
  key: string;
  /** Addresses the profile declares for this metric that the capture lacks. */
  missing: number[];
}

export interface ReplayResult {
  /** True only when at least one expectation was checked and all of them held. */
  ok: boolean;
  /** Resolved profile id; `undefined` when the profile could not be resolved. */
  profileId?: string;
  /** Set when the capture names a profile that is not installed. */
  unknownProfile?: string;
  matched: Expectation[];
  mismatched: Expectation[];
  /** Expectation keys the profile has no metric for — an error, never a skip. */
  unknownMetrics: string[];
  missingRegisters: MissingRegisters[];
  /** How many expectations the capture stated. */
  expectationCount: number;
  tolerance: number;
  /** Human-readable failure lines: structural errors plus one per mismatch. */
  errors: string[];
}

function fail(errors: string[], extra: Partial<ReplayResult> = {}): ReplayResult {
  return {
    ok: false,
    matched: [],
    mismatched: [],
    unknownMetrics: [],
    missingRegisters: [],
    expectationCount: 0,
    tolerance: DEFAULT_TOLERANCE,
    errors,
    ...extra,
  };
}

/**
 * Decode a capture's registers through the real `decode` path and diff the
 * result against the capture's expectations.
 *
 * `profile` may be omitted, in which case the capture's `profile` id is resolved
 * from the runtime registry; an unresolvable id is reported, not thrown, so a
 * CLI can print it alongside other findings. A structurally invalid capture
 * *does* throw — that is an authoring mistake in the file, not a test failure.
 */
export function replayCapture(capture: Capture, profile?: InverterProfile): ReplayResult {
  const parsed = captureSchema.parse(capture);
  const tolerance = parsed.tolerance ?? DEFAULT_TOLERANCE;

  const resolved = profile ?? tryGetProfile(parsed.profile);
  if (!resolved) {
    return fail([`capture names profile "${parsed.profile}", which is not installed`], {
      unknownProfile: parsed.profile,
      tolerance,
    });
  }
  if (resolved.id !== parsed.profile) {
    return fail(
      [`capture names profile "${parsed.profile}" but was replayed against "${resolved.id}"`],
      { profileId: resolved.id, tolerance },
    );
  }

  const { values, missingRegisters } = decodeAll(resolved, parsed.registers);
  const diff = diffExpectations(resolved, values, parsed.expect, tolerance);

  const expectationCount = Object.keys(parsed.expect).length;
  const errors = [...diff.errors];
  if (expectationCount === 0) errors.push("capture states no expectations — nothing was asserted");

  return {
    ok: expectationCount > 0 && diff.mismatched.length === 0 && diff.unknownMetrics.length === 0,
    profileId: resolved.id,
    matched: diff.matched,
    mismatched: diff.mismatched,
    unknownMetrics: diff.unknownMetrics,
    missingRegisters,
    expectationCount,
    tolerance,
    errors,
  };
}

/**
 * Decode every metric the profile declares, and record which declared addresses
 * the capture did not supply. `applyComputed` runs afterwards so `sumOf`/`combine`
 * metrics — which carry no addresses of their own — are covered too; a capture
 * that expects one is the only thing that can catch a broken reference, since the
 * raw metrics it derives from all still decode fine.
 */
function decodeAll(
  profile: InverterProfile,
  registers: Record<string, number>,
): { values: MetricValues; missingRegisters: MissingRegisters[] } {
  const regs = new Map<number, number>();
  for (const [addr, word] of Object.entries(registers)) regs.set(Number(addr), word);

  const values: MetricValues = {};
  const missingRegisters: MissingRegisters[] = [];
  for (const def of profile.metrics) {
    if (def.addresses.length > 0) {
      const missing = def.addresses.filter((a) => !regs.has(a));
      if (missing.length > 0) missingRegisters.push({ key: def.key, missing });
    }
    // #63: an absent address decodes to `undefined`, never a fabricated 0, so an
    // unanswered register must not enter `values` at all.
    const value = decode(def, regs);
    if (value !== undefined) values[def.key] = value;
  }
  applyComputed(profile.metrics, values);
  return { values, missingRegisters };
}

/** Compare decoded values against the capture's expectations, within tolerance. */
function diffExpectations(
  profile: InverterProfile,
  values: MetricValues,
  expect: Record<string, number>,
  tolerance: number,
): {
  matched: Expectation[];
  mismatched: Expectation[];
  unknownMetrics: string[];
  errors: string[];
} {
  const keys = new Set(profile.metrics.map((m) => m.key));
  const matched: Expectation[] = [];
  const mismatched: Expectation[] = [];
  const unknownMetrics: string[] = [];
  const errors: string[] = [];

  for (const [key, expected] of Object.entries(expect)) {
    if (!keys.has(key)) {
      // An error rather than a skip: a typo'd key would otherwise make a capture
      // silently assert nothing while still reporting success.
      unknownMetrics.push(key);
      errors.push(`${key}: no such metric in profile "${profile.id}"`);
      continue;
    }
    const actual = values[key];
    const hit = actual !== undefined && Math.abs(actual - expected) <= tolerance;
    (hit ? matched : mismatched).push({ key, expected, actual });
    if (!hit) errors.push(`${key}: expected ${expected}, got ${actual}`);
  }
  return { matched, mismatched, unknownMetrics, errors };
}
