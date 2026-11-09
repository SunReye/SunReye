import { expect, test } from "bun:test";
import { choices, energy } from "./history.ts";

const DAY = { date: "2026-11-08", start: "2026-11-07T23:00:00Z", end: "2026-11-08T23:00:00Z" };

test("a period's energy is a counter's delta or a power's integral, in kWh", () => {
  expect(energy("pv.energy.total", { ...DAY, delta: 11.5 })).toBe(11.5);
  expect(energy("pv.mppt.power[2]", { ...DAY, mean: 500, integral: 12_000 })).toBe(12);
  expect(energy("battery.soc", { ...DAY, mean: 64, integral: 1536 })).toBeNull();
});

test("the plant comes first among the devices, each series sorted", () => {
  const devices = { "7": { "battery.soc": 64 }, "4294967294": { "pv.power": 1, "grid.power": 2 } };

  expect(choices(devices)).toEqual([
    { device: 4_294_967_294, series: ["grid.power", "pv.power"] },
    { device: 7, series: ["battery.soc"] },
  ]);
});
