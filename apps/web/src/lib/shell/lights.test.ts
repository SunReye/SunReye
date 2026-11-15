/// <reference types="bun" />
import { expect, test } from "bun:test";
import { LIGHTS, pose, pvGlow } from "./lights.ts";

test("the PV light is out before the first reading and while PV is idle", () => {
  expect(pvGlow()).toBe(0);
  expect(pvGlow(0)).toBe(0);
  expect(pvGlow(50)).toBe(0);
  expect(pvGlow(Number.NaN)).toBe(0);
});

test("the PV light rises with production and never passes full", () => {
  expect(pvGlow(100)).toBeCloseTo(0.35, 5);
  expect(pvGlow(3000)).toBeCloseTo(0.7, 5);
  expect(pvGlow(30_000)).toBeCloseTo(0.95, 5);
  expect(pvGlow(Number.POSITIVE_INFINITY)).toBe(0);
});

test("a tick's jitter leaves the PV light where it is", () => {
  expect(pvGlow(2050)).toBe(pvGlow(2000));
});

test("a light starts in its place at full strength", () => {
  for (const light of LIGHTS)
    expect(pose(light, 0)).toEqual({
      transform: "translate(0.00vmax, 0.00vmax) scale(1.000)",
      opacity: 1,
    });
});

test("a light drifts, swells and dims, each on its own course", () => {
  const later = LIGHTS.map((light) => pose(light, 20));

  expect(new Set(later.map(({ transform }) => transform)).size).toBe(4);

  for (const { opacity } of later) {
    expect(opacity).toBeLessThan(1);
    expect(opacity).toBeGreaterThanOrEqual(0.7);
  }
});

test("a quarter of the way across, the PV light is at its farthest: 7 vmax", () => {
  expect(pose("pv", 82 / 4).transform).toStartWith("translate(7.00vmax,");
});

test("a light never leaves its reach or dims below 70 %", () => {
  for (const light of LIGHTS)
    for (let seconds = 0; seconds < 3600; seconds += 7) {
      const { transform, opacity } = pose(light, seconds);
      const [x = 0, y = 0, scale = 0] = [...transform.matchAll(/-?[\d.]+/gu)].map(Number);

      expect(Math.abs(x)).toBeLessThanOrEqual(8);
      expect(Math.abs(y)).toBeLessThanOrEqual(7);
      expect(scale).toBeGreaterThanOrEqual(1);
      expect(scale).toBeLessThanOrEqual(1.12);
      expect(opacity).toBeGreaterThanOrEqual(0.7);
      expect(opacity).toBeLessThanOrEqual(1);
    }
});
