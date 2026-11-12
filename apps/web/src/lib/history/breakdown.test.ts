import { expect, test } from "bun:test";
import { breakdownOf } from "./breakdown.ts";
import type { Sum } from "./flows.ts";

const SUM: Sum = {
  production: 40,
  consumption: 30,
  feedIn: 25,
  purchase: 15,
  selfUsed: 15,
  selfCovered: 15,
  charge: 0,
  discharge: 0,
  ev: 0,
  autarky: 50,
  selfUse: 37.5,
  covered: 20 * 3_600_000,
};

const INPUT = { sum: SUM, money: null, kwp: 8, strings: 2, elapsed: 24 * 3_600_000 };

test("energy splits production and the house load into their parts", () => {
  const rows = breakdownOf("energy", INPUT);

  expect(rows.map((r) => [r.label, r.value])).toEqual([
    ["Produktion", 40],
    ["selbst genutzt", 15],
    ["Einspeisung", 25],
    ["Hausverbrauch", 30],
    ["Netzbezug", 15],
  ]);
});

test("no battery and no car add no rows; with them, they do", () => {
  const rows = breakdownOf("energy", { ...INPUT, sum: { ...SUM, discharge: 4, charge: 5, ev: 6 } });

  expect(rows.map((r) => r.label)).toContain("davon Auto");
  expect(rows.map((r) => r.label)).toContain("Batterie geladen");
});

test("money without a tariff shows dashes; the plant shows its yield and its record", () => {
  expect(breakdownOf("money", INPUT).every((r) => r.value === null)).toBe(true);
  expect(breakdownOf("plant", INPUT).map((r) => r.value)).toEqual([8, 5, (20 / 24) * 100]);
  expect(breakdownOf("plant", INPUT)[2]!.sub).toBe("4 h ohne Daten.");
});
