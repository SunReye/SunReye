/// <reference types="bun" />
import { expect, test } from "bun:test";
import { GROUPS, type Maps, type Pixels } from "./pixels.ts";

function map(key: string): Pixels {
  const maps: Maps = GROUPS.module();
  const found = maps[key];

  if (found === undefined) throw new Error(`no ${key}`);

  return found;
}

function mean({ data }: { readonly data: ArrayLike<number> }): [number, number, number] {
  const sum = [0, 0, 0];

  for (let i = 0; i < data.length; i += 4) {
    sum[0]! += data[i]!;
    sum[1]! += data[i + 1]!;
    sum[2]! += data[i + 2]!;
  }

  const n = data.length / 4;

  return [sum[0]! / n, sum[1]! / n, sum[2]! / n];
}

// Generating every map twice takes seconds; the app does it once, in a worker (ADR 21).
const GENERATES_ALL = { timeout: 30_000 };

test("every material's maps are generated, the same on every run", GENERATES_ALL, () => {
  for (const make of Object.values(GROUPS)) {
    const [first, second]: Maps[] = [make(), make()];

    for (const [key, pixels] of Object.entries(first ?? {})) {
      expect(pixels.data.length).toBe(pixels.w * pixels.h * 4);
      expect(second?.[key]).toEqual(pixels);
    }
  }
});

test("a module is full black: dark and neutral, never blue", () => {
  const [r, g, b] = mean(map("module.map"));

  expect(Math.max(r, g, b)).toBeLessThan(20);
  expect(b - r).toBeLessThan(3);
});

test("only a module's cells glow, not its backsheet between them", () => {
  const { w, data } = map("module.glow");
  const at = (x: number, y: number): number => data[(y * w + x) * 4]!;

  // The middle of the first cell, then the gap at the sheet's corner.
  expect(at(16, 16)).toBeGreaterThan(200);
  expect(at(0, 0)).toBe(0);
});

/** A pixel's red, green and blue. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- read only.
function rgb({ w, data }: Pixels, x: number, y: number): number[] {
  return [...data.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)];
}

test("a module's frame runs round its cells: satin beside the glass, and never glowing", () => {
  const [rough, glow] = [map("module.rough"), map("module.glow")];

  // The frame at the edge, then the middle of the first cell.
  expect(rgb(rough, 1, 160)[0]).toBeGreaterThan((rgb(rough, 16, 10)[0] ?? 0) * 2);
  expect(rgb(glow, 1, 160)[0]).toBe(0);
  expect(rgb(glow, 190, 318)[0]).toBe(0);
});
