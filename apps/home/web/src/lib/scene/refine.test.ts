import { expect, test } from "bun:test";
import { jitter, SAMPLES } from "../../../../../../packages/builder/src/scene/refine.ts";

test("a burst's first frame lies on the settled picture, so nothing jumps as it starts", () => {
  expect(jitter(0)).toEqual([0, 0]);
});

test("a burst's frames stay inside their pixel and fill it evenly", () => {
  const offsets = Array.from({ length: SAMPLES }, (_, i) => jitter(i));

  for (const [x, y] of offsets) {
    expect(Math.abs(x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(y)).toBeLessThanOrEqual(0.5);
  }

  // Each quarter of the pixel gets its share, within one frame.
  for (const [sx, sy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const inside = offsets.filter(([x, y]) => x * sx >= 0 && y * sy >= 0).length;

    expect(Math.abs(inside - SAMPLES / 4)).toBeLessThanOrEqual(2);
  }

  expect(new Set(offsets.map(([x, y]) => `${x},${y}`)).size).toBe(SAMPLES);
});
