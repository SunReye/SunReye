/// <reference types="bun" />
import { expect, test } from "bun:test";
import { untone } from "../../../../../packages/builder/src/scene/tone.ts";

// Khronos PBR Neutral: a colour loses 0.04 a channel at its toe, is left as it is up to a peak
// of 0.76, and is compressed toward 1 above it.

test("under the shoulder a colour is drawn 0.04 brighter, over the exposure", () => {
  const [r, g, b] = untone([0.5, 0.3, 0.2], 1);

  expect([r, g, b].map((v) => Number(v.toFixed(6)))).toEqual([0.54, 0.34, 0.24]);
  expect(untone([0.5, 0.5, 0.5], 2)[0]).toBeCloseTo(0.27, 6);
});

test("a dark colour is drawn by the toe's own curve: 6.25 x² lands on it", () => {
  // 6.25 × 0.04² = 0.01.
  expect(untone([0.01, 0.01, 0.01], 1)[0]).toBeCloseTo(0.04, 6);
  expect(untone([0, 0, 0], 1)).toEqual([0, 0, 0]);
});

test("over the shoulder a colour is drawn ever brighter, and white is finite", () => {
  const drawn = [0.76, 0.8, 0.9, 0.99, 1].map((v) => untone([v, v, v], 1)[0]);

  // At the shoulder nothing is compressed yet.
  expect(drawn[0]).toBeCloseTo(0.8, 6);
  // 0.9 is where a peak of 0.24² / 0.1 − 0.24 + 0.76 = 1.096 lands, before the toe.
  expect(drawn[2]).toBeCloseTo(1.136, 6);
  expect(drawn).toEqual(drawn.toSorted((a, b) => a - b));
  expect(drawn[4]).toBeGreaterThan(50);
  expect(Number.isFinite(drawn[4])).toBe(true);
});

test("a tinted colour over the shoulder keeps its hue: its channels stay in order", () => {
  const [r, g, b] = untone([0.95, 0.9, 0.8], 1);

  expect(r).toBeGreaterThan(g);
  expect(g).toBeGreaterThan(b);
  expect(b).toBeGreaterThan(0.8);
});
