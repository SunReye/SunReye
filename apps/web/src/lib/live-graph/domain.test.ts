/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { valueDomain } from "./domain.ts";

const kw = (...values: readonly number[]) => values.map((v, t) => ({ t, v }));

describe("valueDomain", () => {
  test("rounds past the peak with headroom, on a step that grows with the reach", () => {
    expect(valueDomain(kw(0.2, 0.9), false)).toEqual([0, 1.5]);
    expect(valueDomain(kw(1.1, 2.3), false)).toEqual([0, 3]);
    expect(valueDomain(kw(3, 5), false)).toEqual([0, 6]);
  });

  test("a diverging series keeps both sides of zero, even when it is on one", () => {
    expect(valueDomain(kw(-0.8, -0.3), true)).toEqual([-1, 0.25]);
    expect(valueDomain(kw(1.1, 2.3), true)).toEqual([-0.5, 3]);
    expect(valueDomain(kw(-2.3, 1.1), true)).toEqual([-3, 2]);
  });

  test("a flat zero still has a range", () => {
    expect(valueDomain(kw(0, 0), false)).toEqual([0, 0.5]);
  });
});
