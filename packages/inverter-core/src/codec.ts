import type { MetricDef, RegisterType } from "./types";

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

/** One register word; an address the device never answered reads as 0. */
function word(regs: ReadonlyMap<number, number>, addr: number): number {
  return regs.get(addr) ?? 0;
}

/**
 * The raw integer a metric's register(s) hold, before `scale`/`offset`.
 * `undefined` when there is nothing numeric to read: a `RAW` metric, or a
 * metric whose profile entry is missing the address(es) its type needs.
 */
function rawValue(def: MetricDef, regs: ReadonlyMap<number, number>): number | undefined {
  const [a0, a1] = def.addresses;
  if (a0 === undefined) return undefined;
  switch (def.type) {
    case "U_WORD":
      return word(regs, a0);
    case "S_WORD":
      return toSigned16(word(regs, a0));
    case "U_DWORD":
      // Low word first, high word second (LW,HW). Avoid bit-shift so the
      // 32-bit value stays an exact double rather than a signed int32.
      return a1 === undefined ? undefined : word(regs, a0) + word(regs, a1) * 0x10000;
    case "RAW":
      return undefined;
  }
}

/**
 * Decode a metric from raw register words keyed by absolute address.
 * Returns `undefined` for `RAW`/unreadable metrics.
 */
export function decode(def: MetricDef, regs: ReadonlyMap<number, number>): number | undefined {
  const raw = rawValue(def, regs);
  return raw === undefined ? undefined : raw * def.scale + (def.offset ?? 0);
}

/**
 * Encode an engineering value back to a single 16-bit register word.
 * Only `U_WORD`/`S_WORD` settings are writable.
 */
export function encodeWord(def: MetricDef, value: number): number {
  const raw = Math.round((value - (def.offset ?? 0)) / def.scale);
  if (def.type === "S_WORD") return raw < 0 ? raw + 0x10000 : raw;
  return raw & 0xffff;
}
