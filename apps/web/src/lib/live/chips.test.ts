/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { arrange, Steady, type Box, type Frame, type Label } from "./chips.ts";

/** A phone's hero, the house in its middle under the headline. */
const PHONE: Frame = {
  width: 365,
  height: 521,
  top: 150,
  house: { left: 100, right: 290, top: 250, bottom: 420 },
};

const label = (
  key: string,
  lane: Label["lane"],
  group: number,
  x: number | null,
  w = 110,
): Label => ({ key, lane, group, x, w, h: 28 });

/** The owner's plant: three strings, a marked inverter and battery, and a car east of the house. */
const PLANT = [
  label("M1S", "above", 0, 177, 122),
  label("M1N", "above", 0, 150, 124),
  label("M2S", "above", 0, 244, 114),
  label("grid", "below", 1, null, 102),
  label("house", "below", 1, null, 96),
  label("inverter", "below", 0, 216, 118),
  label("battery", "below", 0, 190, 150),
  label("car", "below", 1, 268, 120),
];

function placed(labels: readonly Label[], frame: Frame = PHONE): Record<string, Box> {
  const boxes = arrange(labels, frame);

  return Object.fromEntries(labels.map(({ key }, i) => [key, boxes[i]!]));
}

function overlaps(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

function inside(box: Box, { width, height }: Frame): boolean {
  return (
    box.x - box.w / 2 >= 0 &&
    box.x + box.w / 2 <= width &&
    box.y - box.h / 2 >= 0 &&
    box.y + box.h / 2 <= height
  );
}

const CASES = {
  "the owner's plant": PLANT,
  "all on one point": Array.from({ length: 7 }, (_, i) => label(`s${i}`, "above", 0, 195)),
  "past every edge": [
    label("a", "above", 0, -50),
    label("b", "above", 0, 500, 160),
    label("c", "below", 0, -80, 160),
    label("d", "below", 1, 900),
  ],
  "nothing marked": [
    label("grid", "below", 1, null),
    label("house", "below", 1, null),
    label("battery", "below", 0, null, 150),
    label("inverter", "below", 0, null, 120),
  ],
} satisfies Record<string, readonly Label[]>;

describe("chips at phone width", () => {
  for (const [name, labels] of Object.entries(CASES)) {
    test(`${name}: never overlap and stay inside the canvas`, () => {
      const boxes = arrange(labels, PHONE);

      expect(boxes).toHaveLength(labels.length);

      for (const [i, a] of boxes.entries()) {
        expect(inside(a, PHONE)).toBe(true);

        for (const b of boxes.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
      }
    });
  }
});

test("strings sit above the house, everything else below it", () => {
  const at = placed(PLANT);

  for (const key of ["M1S", "M1N", "M2S"]) {
    expect(at[key]!.y + 14).toBeLessThan(PHONE.house.top);
    expect(at[key]!.y - 14).toBeGreaterThanOrEqual(PHONE.top);
  }

  for (const key of ["inverter", "battery", "grid", "house", "car"]) {
    expect(at[key]!.y - 14).toBeGreaterThan(PHONE.house.bottom);
  }
});

test("the inverter and battery share the row nearest the house; grid, house and car the next", () => {
  const at = placed(PLANT);

  expect(at.inverter!.y).toBe(at.battery!.y);
  expect(at.grid!.y).toBe(at.house!.y);
  expect(at.car!.y).toBe(at.house!.y);
  expect(at.inverter!.y).toBeLessThan(at.house!.y);
});

test("a row runs in its markers' order, so its leader lines never cross", () => {
  const at = placed(PLANT);

  expect(at.battery!.x).toBeLessThan(at.inverter!.x);

  // Three strings are too wide for one row: the row they share still runs west to east.
  const rows = Map.groupBy(["M1N", "M1S", "M2S"], (key) => at[key]!.y);

  expect(rows.size).toBe(2);

  for (const keys of rows.values()) {
    const across = keys.map((key) => at[key]!.x);

    expect(across).toEqual(across.toSorted((a, b) => a - b));
  }
});

test("a chip without a marker sits beside its row's marked chips, toward the house", () => {
  const at = placed(PLANT);

  // The car stands east of the house's middle: grid and house line up west of it.
  expect(at.grid!.x).toBeLessThan(at.house!.x);
  expect(at.house!.x).toBeLessThan(at.car!.x);
});

test("a lone chip sits at its marker", () => {
  const [box] = arrange([label("a", "above", 0, 180)], PHONE);

  expect(box).toEqual({ x: 180, y: 226, w: 110, h: 28 });
});

test("a house that fills the canvas leaves its lanes inside, under the headline", () => {
  const at = placed(PLANT, { ...PHONE, house: { left: -40, right: 420, top: 20, bottom: 600 } });

  expect(at.M1S!.y - 14).toBeGreaterThanOrEqual(PHONE.top);
  expect(at.house!.y + 14).toBeLessThanOrEqual(PHONE.height);
});

describe("a steady value", () => {
  test("stays while its target moves inside the band", () => {
    const steady = new Steady(16);

    expect(steady.follow("x", 100)).toBe(100);
    expect(steady.follow("x", 112)).toBe(100);
    expect(steady.follow("x", 90)).toBe(100);
  });

  test("is pulled along once its target leaves the band, and stays there on the way back", () => {
    const steady = new Steady(16);

    steady.follow("x", 100);

    expect(steady.follow("x", 130)).toBe(114);
    expect(steady.follow("x", 120)).toBe(114);
    expect(steady.follow("x", 90)).toBe(106);
  });

  test("starts over once cleared", () => {
    const steady = new Steady(16);

    steady.follow("x", 100);
    steady.clear();

    expect(steady.follow("x", 110)).toBe(110);
  });
});
