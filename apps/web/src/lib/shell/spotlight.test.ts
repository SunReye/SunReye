import { expect, test } from "bun:test";
import { watchTint, type Tint } from "./spotlight.ts";

test("the core's tint is set at once and again every 15 minutes, until stopped", async () => {
  const told: (Tint | null)[] = ["dawn", "noon", null];
  const set: (Tint | undefined)[] = [];
  let tick: (() => void) | undefined;
  let period = 0;
  let cleared = false;

  const stop = watchTint({
    read: () => Promise.resolve({ tint: told.shift() ?? null }),
    set: (tint) => {
      set.push(tint);
    },
    every: (ms, fn) => {
      period = ms;
      tick = fn;

      return () => {
        cleared = true;
      };
    },
  });

  await Promise.resolve();
  expect(set).toEqual(["dawn"]);
  expect(period).toBe(15 * 60_000);

  tick?.();
  await Promise.resolve();
  tick?.();
  await Promise.resolve();

  expect(set).toEqual(["dawn", "noon", undefined]);

  stop();
  expect(cleared).toBe(true);
});

test("a refused read keeps the tint it had", async () => {
  const set: (Tint | undefined)[] = [];

  watchTint({
    read: () => Promise.resolve({ problem: "auth.forbidden" }),
    set: (tint) => {
      set.push(tint);
    },
    every: () => () => {},
  });

  await Promise.resolve();
  expect(set).toEqual([]);
});

test("a read that lands after the stop sets nothing", async () => {
  const set: (Tint | undefined)[] = [];

  const stop = watchTint({
    read: () => Promise.resolve({ tint: "noon" }),
    set: (tint) => {
      set.push(tint);
    },
    every: () => () => {},
  });

  stop();
  await Promise.resolve();
  expect(set).toEqual([]);
});
