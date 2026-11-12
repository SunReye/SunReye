import { expect, test } from "bun:test";
import { bandFigure } from "./history.ts";

const H = 3_600_000;

test("a power series fills a band with its energy in kWh, split at the band's edges", () => {
  // 2 kW from 0 to 2 h, then −1 kW (export) to 4 h.
  const points = [
    { start: 0, end: 2 * H, mean: 2000 },
    { start: 2 * H, end: 4 * H, mean: -1000 },
  ];

  expect(bandFigure("grid.power", points, H, 3 * H)).toEqual({ value: 1, covered: 2 * H });
});

test("any other series fills a band with its time-weighted mean", () => {
  const points = [
    { start: 0, end: H, mean: 40 },
    { start: H, end: 4 * H, mean: 80 },
  ];

  expect(bandFigure("battery.soc", points, 0, 4 * H)).toEqual({ value: 70, covered: 4 * H });
  expect(bandFigure("battery.soc", points, 5 * H, 6 * H)).toEqual({ value: 0, covered: 0 });
});
