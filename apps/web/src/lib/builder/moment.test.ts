/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { Core, ModuleType } from "../api/core.ts";
import { perSeries } from "../api/core.harness.ts";
import { emptyDraft, type Draft } from "./modules.ts";
import { load, shareAt, sourceOf, wattsAt } from "./moment.ts";
import { loadPv } from "./pv.ts";

const wasm = new URL(
  "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm",
  import.meta.url,
);

const pv = await loadPv(await Bun.file(wasm).bytes());

test("past days are measured, today and two more forecast, any other day a clear sky", () => {
  expect(sourceOf("2026-11-08", "2026-11-09")).toBe("measured");
  expect(sourceOf("2026-11-09", "2026-11-09")).toBe("forecast");
  expect(sourceOf("2026-11-11", "2026-11-09")).toBe("forecast");
  expect(sourceOf("2026-11-12", "2026-11-09")).toBe("clearSky");
  expect(sourceOf("2026-12-31", "2026-12-30")).toBe("forecast");
  expect(sourceOf("2027-01-02", "2026-12-30")).toBe("clearSky");
});

test("a value holds from its start to before its end, and nothing outside", () => {
  const intervals = [
    { from: 0, to: 10, watts: 5 },
    { from: 10, to: 20, watts: 7 },
  ];

  expect(wattsAt(intervals, 0)).toBe(5);
  expect(wattsAt(intervals, 10)).toBe(7);
  expect(wattsAt(intervals, 20)).toBeNull();
});

const MODULE: ModuleType = {
  id: 7,
  name: "Owner 400",
  pmax: 400,
  vmp: 34,
  imp: 11.76,
  voc: 41,
  isc: 12.5,
  powerCoefficient: -0.35,
  voltageCoefficient: -0.27,
  currentCoefficient: 0.05,
  width: 1.134,
  height: 1.722,
  bypassDiodes: 3,
};

const wiring = {
  moduleType: 7,
  device: 1,
  input: 1,
  modules: 16,
  optimized: 0,
  tilt: 35,
  azimuth: 0,
  loss: 2,
};

/** A saved string and one not saved yet. */
const draft: Draft = {
  ...emptyDraft(),
  strings: [
    { ...wiring, id: 5, name: "South" },
    { ...wiring, name: "New", input: 2 },
  ],
};

const BERLIN = { latitude: 52.52, longitude: 13.38 };

/** A core with `points` of history and forecasts, asked for which series. */
function reading(history: boolean) {
  const asked: string[] = [];

  const core: Pick<Core, "history" | "forecasts"> = {
    history: perSeries(async (device, series: string, from: Readonly<Date>) => {
      await Promise.resolve();
      asked.push(`history ${device} ${series}`);

      return history
        ? {
            tier: "bucket" as const,
            points: [
              {
                start: from.toISOString(),
                end: new Date(from.getTime() + 3_600_000).toISOString(),
                mean: 812,
              },
            ],
          }
        : { tier: "bucket" as const, points: [] };
    }),
    forecasts: perSeries(async (device, series: string, from: Readonly<Date>) => {
      await Promise.resolve();
      asked.push(`forecasts ${device} ${series}`);

      return {
        points: [
          {
            target: from.toISOString(),
            issued: from.toISOString(),
            value: 640,
          },
        ],
      };
    }),
  };

  return { core, asked };
}

const context = { pv, moduleTypes: [MODULE], location: BERLIN };

test("a past day reads each saved string's history; an unsaved string has none", async () => {
  const { core, asked } = reading(true);

  const day = await load({ ...context, core, draft, day: "2026-11-01", today: "2026-11-09" });

  expect(asked).toEqual(["history 1 pv.string.power[5]"]);
  expect(day.source).toBe("measured");
  expect(day.strings.map((s) => wattsAt(s, new Date("2026-11-01T00:30").getTime()))).toEqual([
    812,
    null,
  ]);
});

test("today reads the forecast", async () => {
  const { core, asked } = reading(true);

  const day = await load({ ...context, core, draft, day: "2026-11-09", today: "2026-11-09" });

  expect(asked).toEqual(["forecasts 1 pv.string.power[5]"]);
  expect(day.source).toBe("forecast");
  expect(wattsAt(day.strings[0] ?? [], new Date("2026-11-09T00:10").getTime())).toBe(640);
});

test("a past day before any reading and a far day run a clear sky over every string", async () => {
  const { core } = reading(false);

  const dates = ["2025-06-21", "2027-06-21"];

  const days = await Promise.all(
    dates.map((date) => load({ ...context, core, draft, day: date, today: "2026-11-09" })),
  );

  for (const [i, day] of days.entries()) {
    const noon = new Date(`${dates[i] ?? ""}T13:00`).getTime();

    expect(day.source).toBe("clearSky");
    expect(day.strings.map((s) => (wattsAt(s, noon) ?? 0) > 1000)).toEqual([true, true]);
  }
});

test("without the plant's location a clear sky has nothing to show", async () => {
  const { core } = reading(false);

  const day = await load({
    ...context,
    location: undefined,
    core,
    draft,
    day: "2027-06-21",
    today: "2026-11-09",
  });

  expect(day.strings).toEqual([[], []]);
});

/** A day whose strings each read their `watts` from 0 to before 10. */
const day = (source: "measured" | "forecast", ...watts: readonly number[]) => ({
  source,
  strings: watts.map((value) => [{ from: 0, to: 10, watts: value }]),
});

test("the plant's share of its peak is told for a measured instant alone", () => {
  // Two strings of 16 modules of 400 W: 12.8 kW of peak.
  const strings = [
    { ...wiring, id: 1, name: "Süd" },
    { ...wiring, id: 2, name: "Nord" },
  ];

  expect(shareAt(day("measured", 400, 240), strings, [MODULE], 5)).toBeCloseTo(0.05);
  // One string without a value leaves the other's, of the whole peak.
  expect(shareAt(day("measured", 640), strings, [MODULE], 5)).toBeCloseTo(0.05);
  expect(shareAt(day("measured", 400, 240), strings, [MODULE], 10)).toBeNull();
  expect(shareAt(day("forecast", 400, 240), strings, [MODULE], 5)).toBeNull();
  expect(shareAt(undefined, strings, [MODULE], 5)).toBeNull();
  expect(shareAt(day("measured"), [], [MODULE], 5)).toBeNull();
});
