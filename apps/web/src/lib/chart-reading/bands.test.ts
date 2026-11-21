import { expect, test } from "bun:test";
import { brushBands, clamp } from "./bands.ts";

test("a band index is held between the first band and the last", () => {
  expect([clamp(-1, 5), clamp(3, 5), clamp(9, 5)]).toEqual([0, 3, 5]);
});

test("a brush narrows from the lower band to the higher; one band, or no narrowing, is none", () => {
  const told: (readonly [number, number])[] = [];

  const brush = brushBands(
    (p: readonly [number, number]) => p[0],
    (from, to) => {
      told.push([from, to]);
    },
  );

  expect(brush?.([4, 1], [2, 9])).toBe(true);
  expect(brush?.([3, 0], [3, 7])).toBe(false);
  expect(told).toEqual([[2, 4]]);
  expect(brushBands((p: number) => p)).toBeUndefined();
});
