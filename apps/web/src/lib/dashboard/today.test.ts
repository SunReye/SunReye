import { expect, test } from "bun:test";
import { combined, dayRows, energy, forecastPv, today } from "./today.ts";

const at = (time: string) => `2026-11-12T${time}:00Z`;

test("a day's energy splits into what flowed each way, in kWh", () => {
  // Grid power: one hour importing 2 kW, half an hour exporting 3 kW.
  const flowed = energy([
    { start: at("08:00"), end: at("09:00"), mean: 2000 },
    { start: at("09:00"), end: at("09:30"), mean: -3000 },
  ]);

  expect(flowed.positive).toBe(2);
  expect(flowed.negative).toBe(1.5);
});

test("a gap adds no energy", () => {
  const flowed = energy([
    { start: at("08:00"), end: at("08:30"), mean: 1000 },
    { start: at("10:00"), end: at("10:30"), mean: 1000 },
  ]);

  expect(flowed.positive).toBe(1);
});

test("the peak is the highest mean and when it began", () => {
  const flowed = energy([
    { start: at("11:00"), end: at("11:15"), mean: 6100 },
    { start: at("13:30"), end: at("13:45"), mean: 8600 },
    { start: at("14:00"), end: at("14:15"), mean: 7000 },
  ]);

  expect(flowed.peak).toEqual({ watts: 8600, at: new Date(at("13:30")) });
});

test("a day without a value has no peak", () => {
  expect(energy([])).toEqual({ positive: 0, negative: 0, peak: null });
});

test("today's four figures and the two meters come from the plant's PV, load and grid", () => {
  const hour = (mean: number) => [{ start: at("10:00"), end: at("11:00"), mean }];

  const figures = today({
    pv: energy(hour(8000)),
    load: energy(hour(4000)),
    grid: energy([
      { start: at("10:00"), end: at("10:30"), mean: 2000 },
      { start: at("10:30"), end: at("11:00"), mean: -10_000 },
    ]),
  });

  expect(figures).toMatchObject({ production: 8, consumption: 4, purchase: 1, feedIn: 5 });
  // A quarter of the house came from the grid; five eighths of the PV went to the grid.
  expect(figures.autarky).toBe(75);
  expect(figures.selfUse).toBe(37.5);
});

test("a meter without energy to measure against has no value", () => {
  const none = energy([]);
  const figures = today({ pv: none, load: none, grid: none });

  expect(figures.autarky).toBeNull();
  expect(figures.selfUse).toBeNull();
});

const slot = (time: string, value: number) => ({ target: at(time), value });

test("the PV forecast still to come counts from now to the day's end", () => {
  // Four quarter hours at 4 kW: 4 kWh in all; now is halfway through the second.
  const pv = forecastPv(
    [slot("11:00", 4000), slot("11:15", 4000), slot("11:30", 4000), slot("11:45", 4000)],
    new Date("2026-11-12T11:22:30Z"),
  );

  expect(pv.total).toBe(4);
  expect(pv.remaining).toBe(2.5);
});

test("each inverter's PV forecast adds up at its targets", () => {
  expect(
    combined([
      [slot("11:00", 1000), slot("11:15", 2000)],
      [slot("11:15", 500), slot("11:30", 700)],
    ]),
  ).toEqual([slot("11:00", 1000), slot("11:15", 2500), slot("11:30", 700)]);
});

test("the day chart has a row per quarter hour, PV in kW, actual against forecast", () => {
  const rows = dayRows(
    [
      { start: at("00:05"), end: at("00:10"), mean: 2000 },
      { start: at("00:10"), end: at("00:15"), mean: 4000 },
    ],
    [slot("00:00", 1500), slot("00:30", 2500)],
    { start: new Date(at("00:00")), end: new Date(at("01:00")) },
  );

  expect(rows).toEqual([
    // Weighted by the time each value held, not by how many there were.
    { time: new Date(at("00:00")), actual: 3, forecast: 1.5 },
    { time: new Date(at("00:15")), actual: null, forecast: null },
    { time: new Date(at("00:30")), actual: null, forecast: 2.5 },
    { time: new Date(at("00:45")), actual: null, forecast: null },
  ]);
});
