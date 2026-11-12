import { expect, test } from "bun:test";
import { tint, watchTint } from "./spotlight.ts";

test("the tint follows the sun's elevation and whether it is rising", () => {
  expect(tint(0, true)).toBe("dawn");
  expect(tint(55, true)).toBe("noon");
  expect(tint(55, false)).toBe("noon");
  expect(tint(0, false)).toBe("dusk");
  expect(tint(-40, false)).toBe("night");
  expect(tint(-40, true)).toBe("night");
});

test("twilight is warm, full day and full night are not", () => {
  expect(tint(-5, true)).toBe("dawn");
  expect(tint(5, false)).toBe("dusk");
  expect(tint(-7, true)).toBe("night");
  expect(tint(7, false)).toBe("noon");
});

// A sun that rises at 06:00 and sets at 18:00 UTC, 60° high at noon.
function elevation(unix: number): number {
  const hours = (unix / 3600) % 24;

  return 60 * Math.sin(((hours - 6) / 12) * Math.PI);
}

test("the tint is set at once and again every 15 minutes, until stopped", () => {
  const set: string[] = [];
  let tick: (() => void) | undefined;
  let period = 0;
  let cleared = false;
  let now = Date.parse("2026-11-12T06:00:00Z");

  const stop = watchTint({
    elevation,
    set: (value) => {
      set.push(value);
    },
    now: () => now,
    every: (ms, fn) => {
      period = ms;
      tick = fn;

      return () => {
        cleared = true;
      };
    },
  });

  expect(set).toEqual(["dawn"]);
  expect(period).toBe(15 * 60_000);

  now = Date.parse("2026-11-12T12:00:00Z");
  tick?.();
  now = Date.parse("2026-11-12T18:00:00Z");
  tick?.();
  now = Date.parse("2026-11-12T00:00:00Z");
  tick?.();

  expect(set).toEqual(["dawn", "noon", "dusk", "night"]);

  stop();
  expect(cleared).toBe(true);
});
