import { expect, test } from "bun:test";
import { dayOf } from "../range/calendar.ts";
import { rangeFor, type Calendar } from "../range/range.ts";
import type { Sum } from "./flows.ts";
import { baselineLabel, change, delta, verdict } from "./words.ts";

const TODAY = dayOf(2026, 10, 12);
const CAL: Calendar = { today: TODAY, hour: 15, last: TODAY };

const SUM: Sum = {
  production: 412,
  consumption: 300,
  feedIn: 200,
  purchase: 88,
  selfUsed: 212,
  selfCovered: 212,
  charge: 0,
  discharge: 0,
  ev: 0,
  autarky: 70.67,
  selfUse: 51.5,
  covered: 1,
};

const base = (production: number) => ({ sum: { ...SUM, production }, money: null });

test("the verdict answers the question for the range, against its baseline", () => {
  const month = rangeFor("month", dayOf(2026, 9, 3));

  expect(verdict({ metric: "energy", cal: CAL, range: month, sum: SUM, base: base(380) })).toBe(
    "Im Oktober hat die Anlage 412 kWh erzeugt, 8 % mehr als im Vormonat.",
  );
  expect(
    verdict({ metric: "energy", cal: CAL, range: rangeFor("day", TODAY), sum: SUM, base: null }),
  ).toBe("Heute hat die Anlage 412 kWh erzeugt.");
  expect(
    verdict({ metric: "autarky", cal: CAL, range: rangeFor("week", TODAY), sum: SUM, base: null }),
  ).toBe("Diese Woche kamen 71 % des Hausverbrauchs aus eigener Erzeugung, 88,0 kWh aus dem Netz.");
});

test("a range with nothing recorded says so", () => {
  const empty = { ...SUM, covered: 0, production: 0 };

  expect(
    verdict({ metric: "energy", cal: CAL, range: rangeFor("day", TODAY), sum: empty, base: null }),
  ).toBe("Für diesen Zeitraum gibt es keine Aufzeichnung.");
});

test("a change is relative, signed, and absent without a baseline", () => {
  expect(change(110, 100)).toBeCloseTo(0.1);
  expect(change(5, 0)).toBeNull();
  expect(delta(-0.123)).toBe("−12 %");
  expect(delta(0.05, true)).toBe("+5 Pkt.");
  expect(delta(null)).toBe("–");
});

test("a mark is named after the baseline: the period before, or the year before", () => {
  const day = rangeFor("day", dayOf(2026, 10, 3));

  expect(baselineLabel(day, "prev")).toBe("Vortag");
  expect(baselineLabel(day, "year")).toBe("Vorjahr");
});
