import { getLogger } from "@logtape/logtape";

import type { MetricDef, RegisterType } from "./types";

/**
 * Library logger — a no-op until the host app configures LogTape.
 */
const log = getLogger(["inverter-core", "codec"]);

/** Number of 16-bit registers a type occupies (for contiguous-read planning). */
export function registerWidth(type: RegisterType, addresses: number[]): number {
  switch (type) {
    case "U_DWORD":
      return 2;
    case "RAW":
      return addresses.length;
    default:
      return 1;
  }
}

function toSigned16(v: number): number {
  return v > 0x7fff ? v - 0x10000 : v;
}

/**
 * The raw integer a metric's register(s) hold, before `scale`/`offset`.
 * `undefined` when there is nothing numeric to read: a `RAW` metric, a metric
 * whose profile entry is missing the address(es) its type needs, or — the
 * important one — an address the device did not answer. An absent register must
 * never decode as 0: zero is a legitimate reading for `grid.power` (balanced
 * house) and `battery.power` (idle), so a fabricated zero is indistinguishable
 * from the real thing and would steer the automation engines.
 */
function rawValue(def: MetricDef, regs: ReadonlyMap<number, number>): number | undefined {
  const [a0, a1] = def.addresses;
  if (a0 === undefined) return undefined;
  const w0 = regs.get(a0);
  if (w0 === undefined) return undefined;
  switch (def.type) {
    case "U_WORD":
      return w0;
    case "S_WORD":
      return toSigned16(w0);
    case "U_DWORD": {
      // Low word first, high word second (LW,HW). Avoid bit-shift so the
      // 32-bit value stays an exact double rather than a signed int32.
      if (a1 === undefined) return undefined;
      const w1 = regs.get(a1);
      return w1 === undefined ? undefined : w0 + w1 * 0x10000;
    }
    case "RAW":
      return undefined;
  }
}

/** A metric whose decoded value has been clamped to its declared `range`. */
export interface ClampReport {
  key: string;
  /** How many reads have been clamped since the last reset. */
  count: number;
  /** The unclamped value of the most recent clamped read. */
  lastValue: number;
}

/**
 * Clamps seen so far, keyed by metric. A clamp means a device fault or a wrong
 * profile, both worth surfacing — but it repeats every poll, so it is counted
 * per key and logged only the first time rather than once per read.
 */
const clamps = new Map<string, ClampReport>();

/** Every metric clamped since the last {@link resetClampReports}, in first-seen order. */
export function clampReports(): readonly ClampReport[] {
  return [...clamps.values()];
}

/** Forget the clamp history — the next clamp of a key logs and counts afresh. */
export function resetClampReports(): void {
  clamps.clear();
}

function reportClamp(def: MetricDef, value: number, clamped: number): void {
  const seen = clamps.get(def.key);
  if (seen) {
    seen.count += 1;
    seen.lastValue = value;
    return;
  }
  clamps.set(def.key, { key: def.key, count: 1, lastValue: value });
  log.warn("{key} read {value}, outside range — clamped to {clamped}", {
    key: def.key,
    value,
    clamped,
  });
}

/**
 * Decode a metric from raw register words keyed by absolute address.
 * Returns `undefined` for `RAW`/unreadable metrics.
 *
 * Every value here originates outside the process, so a declared `range` is
 * enforced at this one boundary: a cold or error-state register answering
 * `0xFFFF` would otherwise persist a 655.35 % state of charge. A metric without
 * a `range` gets no bounds at all — never an invented default.
 */
export function decode(def: MetricDef, regs: ReadonlyMap<number, number>): number | undefined {
  const raw = rawValue(def, regs);
  if (raw === undefined) return undefined;
  const value = raw * def.scale + (def.offset ?? 0);
  if (!def.range) return value;
  const clamped = Math.min(def.range.max, Math.max(def.range.min, value));
  if (clamped !== value) reportClamp(def, value, clamped);
  return clamped;
}

/** Inclusive raw-value limits of each writable register type. */
const WORD_LIMITS: Record<"U_WORD" | "S_WORD", { min: number; max: number }> = {
  U_WORD: { min: 0, max: 0xffff },
  S_WORD: { min: -0x8000, max: 0x7fff },
};

/**
 * Encode an engineering value back to a single 16-bit register word.
 * Only `U_WORD`/`S_WORD` settings are writable.
 *
 * Throws when the rounded raw value does not fit the register type. This is the
 * unconditional last line of defence on the write path: a silent 16-bit wrap
 * turns a rejected 70000 into a plausible 4464 on live grid-tied hardware, and
 * not every caller passes through the API's range validation.
 */
export function encodeWord(def: MetricDef, value: number): number {
  const type = def.type === "S_WORD" ? "S_WORD" : "U_WORD";
  const raw = Math.round((value - (def.offset ?? 0)) / def.scale);
  const { min, max } = WORD_LIMITS[type];
  if (!Number.isFinite(raw) || raw < min || raw > max) {
    throw new RangeError(
      `${def.key}: ${value} encodes to raw ${raw}, outside ${type} range [${min}, ${max}]`,
    );
  }
  return raw < 0 ? raw + 0x10000 : raw;
}
