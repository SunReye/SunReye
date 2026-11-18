import { expect, test } from "bun:test";
import { cyclesOf, roundTrip } from "./battery.ts";

/** A 10 kWh battery that took 10 kWh and gave 9 kWh, at half charge at both ends. */
const BALANCED = { charged: 10, discharged: 9, soc: [50, 50], capacity: 10 } as const;

test("a range that ends as full as it began kept what it gave of what it took", () => {
  expect(roundTrip(BALANCED)).toBeCloseTo(90);
});

test("what a range stored by its end counts as kept, not lost", () => {
  // It took 10 kWh, gave 4 and holds 5 more than it began with: 4 of the 5 that went through.
  expect(roundTrip({ ...BALANCED, discharged: 4, soc: [20, 70] })).toBeCloseTo(80);
  // It began fuller: the 2 kWh it ran down came out on top of what it took.
  expect(roundTrip({ ...BALANCED, discharged: 10.8, soc: [60, 40] })).toBeCloseTo(90);
});

test("without its state of charge or capacity, from next to nothing or past 100 %, it states none", () => {
  expect(roundTrip({ ...BALANCED, capacity: null })).toBeNull();
  expect(roundTrip({ ...BALANCED, soc: null })).toBeNull();
  expect(roundTrip({ ...BALANCED, charged: 0.01, discharged: 0 })).toBeNull();
  // A range that charged only into what it kept passed nothing through.
  expect(roundTrip({ ...BALANCED, discharged: 0, soc: [0, 100] })).toBeNull();
  expect(roundTrip({ ...BALANCED, discharged: 12 })).toBeNull();
});

test("a range's cycles are what it discharged over the capacity", () => {
  expect(cyclesOf(15, 10)).toBeCloseTo(1.5);
  expect(cyclesOf(15, null)).toBeNull();
  expect(cyclesOf(15, 0)).toBeNull();
});
