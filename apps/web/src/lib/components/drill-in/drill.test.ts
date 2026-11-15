/// <reference types="bun" />
import { expect, test } from "bun:test";
import { settle, slideMs } from "./drill.ts";

test("a full slide takes ADR 21's 280–350 ms", () => {
  expect(slideMs(0, 1)).toBeGreaterThanOrEqual(280);
  expect(slideMs(1, 0)).toBeLessThanOrEqual(350);
});

test("a reversed slide takes only the time for the way left", () => {
  expect(slideMs(0.3, 0)).toBeLessThan(slideMs(1, 0));
});

test("a release settles where the finger was heading", () => {
  // Flicked back fast from nearly open.
  expect(settle(0.9, -2)).toBe(0);
  // Let go past halfway without a push.
  expect(settle(0.4, 0)).toBe(0);
  // Let go before halfway.
  expect(settle(0.7, 0)).toBe(1);
  // Past halfway, but pushed open again.
  expect(settle(0.4, 1)).toBe(1);
});
