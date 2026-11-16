import { expect, test } from "bun:test";
import { blocked, lanesOf } from "./lanes.ts";
import type { Chosen } from "./picker.ts";

const SPAN = { first: "2026-01-01T00:00:00Z", last: "2026-11-15T12:00:00Z" };

function chosen(series: string, unit: string | null, kind: Chosen["kind"] = "measurement"): Chosen {
  return {
    ref: { device: 1, series },
    label: series,
    device: "Deye",
    estimated: false,
    removed: false,
    unit,
    kind,
    ...SPAN,
  };
}

const W = (n: number) => chosen(`pv.mppt.power[${n}]`, "W");

test("series of one unit share a lane, in the order they were chosen", () => {
  const { lanes } = lanesOf([W(1), chosen("battery.soc", "%"), W(2)]);

  expect(lanes.map((l) => [l.unit, l.series.map((s) => s.chosen.ref.series)])).toEqual([
    ["W", ["pv.mppt.power[1]", "pv.mppt.power[2]"]],
    ["%", ["battery.soc"]],
  ]);
});

test("statuses stand in a lane of their own, apart from a measurement without a unit", () => {
  const { lanes } = lanesOf([
    chosen("inverter.status", null, "status"),
    chosen("extra.ratio", null),
    chosen("battery.status", null, "status"),
  ]);

  expect(lanes.map((l) => [l.states, l.series.length])).toEqual([
    [true, 2],
    [false, 1],
  ]);
});

test("every drawn series has a colour of its own, a role's flow colour first", () => {
  const { lanes } = lanesOf([W(1), W(2), chosen("battery.soc", "%"), chosen("load.power", "W")]);
  const colours = lanes.flatMap((l) => l.series.map((s) => s.colour));

  // A second PV series never borrows another flow's colour (ADR 21): it takes a neutral one.
  expect(colours).toEqual([
    "var(--e-solar)",
    "var(--chart-1)",
    "var(--e-house)",
    "var(--e-battery)",
  ]);
});

test("a 7th series cannot be added", () => {
  const six = [1, 2, 3, 4, 5, 6].map((n) => W(n));

  expect(blocked(six, W(7))).toBe("series");
  expect(blocked(six.slice(1), W(7))).toBeNull();
});

test("a 5th lane cannot be added, a series of a lane already there can", () => {
  const four = [W(1), chosen("a", "V"), chosen("b", "A"), chosen("c", "%")];

  expect(blocked(four, chosen("d", "°C"))).toBe("lanes");
  expect(blocked(four, chosen("grid.phase.voltage[2]", "V"))).toBeNull();
});

test("a route past the caps draws six series in the first four lanes", () => {
  const { lanes, left } = lanesOf([
    W(1),
    chosen("a", "V"),
    chosen("b", "A"),
    chosen("c", "%"),
    chosen("d", "°C"),
    W(2),
    W(3),
    W(4),
  ]);

  expect(lanes.map((l) => l.unit)).toEqual(["W", "V", "A", "%"]);
  expect(lanes[0]!.series).toHaveLength(3);
  expect(left.map((s) => s.ref.series)).toEqual(["d", "pv.mppt.power[4]"]);
});

test("a series the catalog does not list has no lane", () => {
  const gone = { ...chosen("pv.power", null, null), first: null, last: null };
  const { lanes, absent } = lanesOf([gone, W(1)]);

  expect(lanes).toHaveLength(1);
  expect(absent).toEqual([gone]);
});
