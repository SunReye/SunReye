import { expect, test } from "bun:test";
import { correctionGrid, stringRows } from "./strings.ts";

const WIRING = { device: 1, azimuth: 0, tilt: 30, loss: 0, moduleType: 7, optimized: 0 };

const STRINGS = [
  { id: 1, name: "Süd", input: 1, modules: 10, ...WIRING },
  { id: 2, name: "Nord", input: 1, modules: 5, ...WIRING },
  { id: 3, name: "West", input: 2, modules: 8, ...WIRING },
];

const cell = (month: number, hour: number, factor: number) => ({ month, hour, factor });

test("strings compare by specific yield; a shared input makes its strings estimated", () => {
  const rows = stringRows(STRINGS, {
    pmax: new Map([[7, 400]]),
    kwh: new Map([
      [1, 20],
      [2, 6],
    ]),
    corrections: [],
  });

  expect(rows.map((r) => [r.name, r.kwp, r.perKwp, r.estimated])).toEqual([
    ["Süd", 4, 5, true],
    ["Nord", 2, 3, true],
    ["West", 3.2, null, false],
  ]);
});

test("measured over modelled is the input's last 30 days; under 92 % flags the string weak", () => {
  const rows = stringRows(STRINGS, {
    pmax: new Map([[7, 400]]),
    kwh: new Map(),
    corrections: [
      { device: 1, input: 1, factors: [], recent: { measured: 90, modelled: 100 } },
      { device: 1, input: 2, factors: [], recent: { measured: 50, modelled: 0 } },
    ],
  });

  expect(rows.map((r) => [r.ratio, r.flag])).toEqual([
    [0.9, "weak"],
    [0.9, "weak"],
    [null, null],
  ]);
});

test("mornings well over the model and afternoons under it flag the face", () => {
  const factors = [8, 9, 10, 11].flatMap((h) => [cell(6, h, 1.1), cell(7, h, 1.1)]);

  factors.push(...[14, 15, 16, 17].map((h) => cell(6, h, 0.95)));

  const [row] = stringRows(STRINGS.slice(2), {
    pmax: new Map([[7, 400]]),
    kwh: new Map(),
    corrections: [{ device: 1, input: 2, factors, recent: { measured: 99, modelled: 100 } }],
  });

  expect(row!.flag).toBe("face");
  expect(row!.skew).toBeCloseTo(0.075);
});

test("the correction grid is month by hour; an unlearned cell is empty", () => {
  const grid = correctionGrid({
    device: 1,
    input: 1,
    factors: [cell(1, 0, 0.8), cell(12, 23, 1.2)],
  });

  expect(grid).toHaveLength(12);
  expect(grid[0]![0]).toBe(0.8);
  expect(grid[11]![23]).toBe(1.2);
  expect(grid[5]![12]).toBeNull();
  expect(correctionGrid(undefined)[0]![0]).toBeNull();
});
