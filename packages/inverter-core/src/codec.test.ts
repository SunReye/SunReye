import { describe, expect, test } from "bun:test";

import { decode, encodeWord, registerWidth } from "./codec";
import type { MetricDef, RegisterType } from "./types";

/** Minimal metric definition — only the encoding fields matter here. */
const def = (over: Partial<MetricDef> & { type: RegisterType }): MetricDef =>
  ({
    key: "m",
    topic: "m",
    label: "m",
    unit: null,
    group: "test",
    addresses: [10],
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

  test("an unanswered register reads as 0", () => {
    expect(decode(def({ type: "U_WORD" }), regs([]))).toBe(0);
    expect(decode(def({ type: "U_DWORD", addresses: [10, 11] }), regs([[10, 5]]))).toBe(5);
  });

  test("RAW never yields a numeric value", () => {
    expect(decode(def({ type: "RAW", addresses: [10, 11, 12] }), regs([[10, 1]]))).toBeUndefined();
  });

  test("a metric missing the addresses its type needs decodes to undefined", () => {
    expect(decode(def({ type: "U_WORD", addresses: [] }), regs([[10, 1]]))).toBeUndefined();
    expect(decode(def({ type: "U_DWORD", addresses: [10] }), regs([[10, 1]]))).toBeUndefined();
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

  test("U_WORD masks to 16 bits", () => {
    expect(encodeWord(def({ type: "U_WORD" }), 0x1_0001)).toBe(1);
  });

  test("rounds to the nearest raw step", () => {
    expect(encodeWord(def({ type: "U_WORD", scale: 0.1 }), 12.55)).toBe(126);
  });
});
