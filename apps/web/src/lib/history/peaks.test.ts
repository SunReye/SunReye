import { expect, test } from "bun:test";
import { dayOf } from "../range/calendar.ts";
import { rangeFor } from "../range/range.ts";
import { NO_PLANT, type Plant } from "./flows.ts";
import type { Rolled } from "./history.ts";
import { peaksOf } from "./peaks.ts";

const H = 3_600_000;
const DAY = dayOf(2026, 10, 3);
const T0 = DAY * 24 * H;

/** Rollups `length` ms long from T0 on, one per highest reading in W. */
const rolled = (length: number, ...max: readonly (number | null)[]): Rolled[] =>
  max.map((v, i) => ({
    start: T0 + i * length,
    end: T0 + (i + 1) * length,
    integral: 0,
    mean: 0,
    max: v,
    covered: length,
  }));

const PLANT: Plant = {
  load: [],
  days: {
    ...NO_PLANT.days,
    pv: rolled(24 * H, 4200, 8412, 2645),
    load: rolled(24 * H, 12_198, 6744, null),
    imported: rolled(24 * H, 0, 0, 0),
  },
  hours: { ...NO_PLANT.hours, pv: rolled(H, 0, 900, 7829, 3000) },
};

test("a range of days names each flow's highest power and its day, which it opens", () => {
  const peaks = peaksOf(PLANT, { from: T0, to: T0 + 3 * 24 * H, hours: false, zone: "UTC" });

  expect(peaks.map((p) => [p.label, p.value, p.when])).toEqual([
    ["PV-Leistung", 8412, "4. Nov."],
    ["Hausverbrauch", 12_198, "3. Nov."],
  ]);
  expect(peaks[0]?.range).toEqual(rangeFor("day", DAY + 1));
});

test("a day names the hour, and opens nothing", () => {
  const peaks = peaksOf(PLANT, { from: T0, to: T0 + 24 * H, hours: true, zone: "UTC" });

  expect(peaks.map((p) => [p.label, p.value, p.when, p.range])).toEqual([
    ["PV-Leistung", 7829, "2:00–3:00 Uhr", null],
  ]);
});

test("rollups outside the range do not count", () => {
  const peaks = peaksOf(PLANT, {
    from: T0 + 2 * 24 * H,
    to: T0 + 3 * 24 * H,
    hours: false,
    zone: "UTC",
  });

  expect(peaks.map((p) => p.value)).toEqual([2645]);
});
