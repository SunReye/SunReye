/// <reference types="bun" />
import { expect, test } from "bun:test";
import { hapticsOn } from "./src/haptics.ts";

const free = { lowPower: false, reducedMotion: false } as const;

test("haptics default to on for touch and off otherwise", () => {
  expect(hapticsOn({ ...free, stored: null, touch: true })).toBe(true);
  expect(hapticsOn({ ...free, stored: null, touch: false })).toBe(false);
});

test("the switch overrides the default", () => {
  expect(hapticsOn({ ...free, stored: "off", touch: true })).toBe(false);
  expect(hapticsOn({ ...free, stored: "on", touch: false })).toBe(true);
});

test("low power and reduced motion force haptics off even when switched on", () => {
  for (const forced of [{ lowPower: true }, { reducedMotion: true }]) {
    expect(hapticsOn({ ...free, stored: "on", touch: true, ...forced })).toBe(false);
  }
});
