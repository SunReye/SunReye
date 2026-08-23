import { beforeEach, describe, expect, test } from "bun:test";

import { clampReports, decode, encodeWord, registerWidth, resetClampReports } from "./codec";
import type { MetricDef, RegisterType } from "./types";

/** Minimal metric definition — only the encoding fields matter here. */
const def = ({
  type,
  addresses = [10],
  ...over
}: Partial<MetricDef> & { type: RegisterType }): MetricDef =>
  ({
    key: "m",
    topic: "m",
    label: "m",
    unit: null,
    group: "test",
    type,
    addresses,
    // The codec addresses through the binding; the legacy mirror above stays in
    // step with it exactly as `hydrateProfile` keeps it.
    binding: { via: "modbus", addr: addresses, type },
    scale: 1,
    access: "r",
    ...over,
  }) as MetricDef;

const regs = (entries: [number, number][]) => new Map(entries);

describe("registerWidth", () => {
  test("U_DWORD spans two words, RAW spans its address list, everything else one", () => {
    expect(registerWidth("U_DWORD", [10, 11])).toBe(2);
    expect(registerWidth("RAW", [10, 11, 12])).toBe(3);
    expect(registerWidth("U_WORD", [10])).toBe(1);
    expect(registerWidth("S_WORD", [10])).toBe(1);
  });
});

describe("decode", () => {
  test("U_WORD applies scale then offset", () => {
    expect(decode(def({ type: "U_WORD", scale: 0.1 }), regs([[10, 1250]]))).toBeCloseTo(125);
    expect(
      decode(def({ type: "U_WORD", scale: 0.1, offset: -100 }), regs([[10, 1250]])),
    ).toBeCloseTo(25);
  });

  test("S_WORD reads two's complement as negative", () => {
    expect(decode(def({ type: "S_WORD" }), regs([[10, 0xffff]]))).toBe(-1);
    expect(decode(def({ type: "S_WORD" }), regs([[10, 0x7fff]]))).toBe(32767);
    expect(decode(def({ type: "S_WORD" }), regs([[10, 0x8000]]))).toBe(-32768);
  });

  test("U_DWORD combines low word first, high word second", () => {
    const d = def({ type: "U_DWORD", addresses: [10, 11] });
    expect(
      decode(
        d,
        regs([
          [10, 0x0001],
          [11, 0x0002],
        ]),
      ),
    ).toBe(0x0001 + 0x0002 * 0x10000);
  });

  test("U_DWORD stays an exact double past the int32 sign bit", () => {
    const d = def({ type: "U_DWORD", addresses: [10, 11] });
    expect(
      decode(
        d,
        regs([
          [10, 0xffff],
          [11, 0xffff],
        ]),
      ),
    ).toBe(4294967295);
  });

  test("an absent register decodes to undefined, not to a fabricated zero", () => {
    expect(decode(def({ type: "U_WORD" }), regs([]))).toBeUndefined();
    // The dangerous case: with an offset, a missing word would look like a
    // plausible reading rather than an obvious zero.
    expect(decode(def({ type: "S_WORD", scale: 0.1, offset: -100 }), regs([]))).toBeUndefined();
  });

  test("a register the device answered with zero is still a real reading", () => {
    expect(decode(def({ type: "S_WORD" }), regs([[10, 0]]))).toBe(0);
  });

  test("a U_DWORD missing either of its words decodes to undefined", () => {
    const d = def({ type: "U_DWORD", addresses: [10, 11] });
    expect(decode(d, regs([[10, 5]]))).toBeUndefined();
    expect(decode(d, regs([[11, 5]]))).toBeUndefined();
  });

  test("an address answered elsewhere in the frame does not stand in for this one", () => {
    expect(decode(def({ type: "U_WORD", addresses: [10] }), regs([[11, 7]]))).toBeUndefined();
  });

  test("RAW never yields a numeric value", () => {
    expect(decode(def({ type: "RAW", addresses: [10, 11, 12] }), regs([[10, 1]]))).toBeUndefined();
  });

  test("a metric missing the addresses its type needs decodes to undefined", () => {
    expect(decode(def({ type: "U_WORD", addresses: [] }), regs([[10, 1]]))).toBeUndefined();
    expect(decode(def({ type: "U_DWORD", addresses: [10] }), regs([[10, 1]]))).toBeUndefined();
  });
});

describe("decode range clamping", () => {
  beforeEach(() => {
    resetClampReports();
  });

  const soc = def({ type: "U_WORD", scale: 0.01, range: { min: 0, max: 100 }, key: "battery.soc" });

  test("a cold or error-state register answering 0xFFFF clamps to range.max", () => {
    expect(decode(soc, regs([[10, 0xffff]]))).toBe(100);
  });

  test("clamps up to range.min", () => {
    const d = def({ type: "S_WORD", range: { min: -10, max: 10 }, key: "t" });
    expect(decode(d, regs([[10, 0xffff]]))).toBe(-1);
    expect(decode(d, regs([[10, 0xf000]]))).toBe(-10);
  });

  test("leaves an in-range value alone, limits included", () => {
    expect(decode(soc, regs([[10, 0]]))).toBe(0);
    expect(decode(soc, regs([[10, 10_000]]))).toBe(100);
    expect(decode(soc, regs([[10, 4200]]))).toBeCloseTo(42);
    expect(clampReports()).toEqual([]);
  });

  test("a metric with no range is completely unchanged — no default bounds", () => {
    const d = def({ type: "U_WORD", scale: 0.1, key: "energy" });
    expect(decode(d, regs([[10, 0xffff]]))).toBeCloseTo(6553.5);
    const signed = def({ type: "S_WORD", key: "grid.power" });
    expect(decode(signed, regs([[10, 0x8000]]))).toBe(-32768);
    expect(clampReports()).toEqual([]);
  });

  test("a clamp is reported once per metric key, not once per read", () => {
    decode(soc, regs([[10, 0xffff]]));
    decode(soc, regs([[10, 0xfffe]]));
    decode(soc, regs([[10, 0xfffd]]));

    const reports = clampReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]?.key).toBe("battery.soc");
    expect(reports[0]?.count).toBe(3);
  });

  test("separate keys are reported separately", () => {
    decode(soc, regs([[10, 0xffff]]));
    decode(def({ type: "U_WORD", range: { min: 0, max: 5 }, key: "other" }), regs([[10, 9]]));

    expect(clampReports().map((r) => r.key)).toEqual(["battery.soc", "other"]);
  });

  test("an undecodable metric is never reported as clamped", () => {
    expect(decode(soc, regs([]))).toBeUndefined();
    expect(clampReports()).toEqual([]);
  });
});

describe("encodeWord", () => {
  test("round-trips a scaled, offset value", () => {
    const d = def({ type: "U_WORD", scale: 0.1, offset: -100 });
    expect(encodeWord(d, 25)).toBe(1250);
    expect(decode(d, regs([[10, encodeWord(d, 25)]]))).toBeCloseTo(25);
  });

  test("S_WORD encodes a negative value as two's complement", () => {
    expect(encodeWord(def({ type: "S_WORD" }), -1)).toBe(0xffff);
    expect(encodeWord(def({ type: "S_WORD" }), 1)).toBe(1);
  });

  test("rounds to the nearest raw step", () => {
    expect(encodeWord(def({ type: "U_WORD", scale: 0.1 }), 12.55)).toBe(126);
  });

  test("U_WORD accepts its exact limits", () => {
    expect(encodeWord(def({ type: "U_WORD" }), 0)).toBe(0);
    expect(encodeWord(def({ type: "U_WORD" }), 0xffff)).toBe(0xffff);
  });

  test("U_WORD throws instead of wrapping past 16 bits", () => {
    // 70000 & 0xffff silently became 4464 — on a register-write path.
    expect(() => encodeWord(def({ type: "U_WORD" }), 70_000)).toThrow(/70000/);
    expect(() => encodeWord(def({ type: "U_WORD" }), 0x1_0001)).toThrow();
  });

  test("U_WORD throws on a negative value rather than sign-wrapping it", () => {
    expect(() => encodeWord(def({ type: "U_WORD" }), -1)).toThrow();
  });

  test("S_WORD accepts its exact limits", () => {
    expect(encodeWord(def({ type: "S_WORD" }), -0x8000)).toBe(0x8000);
    expect(encodeWord(def({ type: "S_WORD" }), 0x7fff)).toBe(0x7fff);
  });

  test("S_WORD throws on a value outside two's-complement range", () => {
    expect(() => encodeWord(def({ type: "S_WORD" }), -40_000)).toThrow(/-40000/);
    expect(() => encodeWord(def({ type: "S_WORD" }), 40_000)).toThrow();
  });

  test("the scaled value, not the engineering value, is what must fit", () => {
    // 5000 W at scale 0.1 is raw 50000 — fits U_WORD, overflows S_WORD.
    expect(encodeWord(def({ type: "U_WORD", scale: 0.1 }), 5000)).toBe(50_000);
    expect(() => encodeWord(def({ type: "S_WORD", scale: 0.1 }), 5000)).toThrow();
  });

  test("a non-finite value never reaches the wire", () => {
    expect(() => encodeWord(def({ type: "U_WORD" }), Number.NaN)).toThrow();
    expect(() => encodeWord(def({ type: "U_WORD" }), Number.POSITIVE_INFINITY)).toThrow();
  });

  test("round-trips every raw step across the valid range of a scaled, offset metric", () => {
    const d = def({ type: "S_WORD", scale: 0.1, offset: -100 });
    for (let raw = -0x8000; raw <= 0x7fff; raw += 337) {
      const value = raw * 0.1 - 100;
      const word = encodeWord(d, value);
      expect(decode(d, regs([[10, word]]))).toBeCloseTo(value, 6);
    }
  });
});
