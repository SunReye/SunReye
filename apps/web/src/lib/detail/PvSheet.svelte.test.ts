// The PV, inverter and string sheets (ADR 21 "Sheet content"): the range's energy and its peak
// with time, actual against forecast, and the inverter's temperature where its profile maps one.
import { afterEach, beforeEach, expect, test } from "vitest";
import "../../app.css";
import {
  fetched,
  INVERTER,
  prepare,
  restore,
  rollup,
  served,
  show,
  type Asked,
} from "./detail.harness.ts";

beforeEach(prepare);

afterEach(restore);

test("a string's overview sets today against its own forecast, read from its inverter", async () => {
  const { screen } = await show("string-1");
  const sheet = screen.getByRole("dialog", { name: "Süd" });
  const overview = sheet.getByRole("tabpanel", { name: "Übersicht" });

  await expect.element(overview.getByRole("term").filter({ hasText: "Prognose" })).toBeVisible();
  await expect.element(overview.getByText("8,0 kWh")).toBeVisible();
  expect(fetched).toContain(
    "/api/v1/devices/1/forecasts pv.string.power[1] 2026-11-12T00:00:00.000Z",
  );
});

/** An hourly rollup from `h` o'clock on `day`: `wh` made, at most `max`. */
const hour = (h: number, wh: number, max: number, day = "2026-11-12") => ({
  ...rollup(Date.parse(`${day}T${String(h).padStart(2, "0")}:00:00Z`), wh),
  max,
});

/** String 1 made 4 kWh today, its peak 2.6 kW from 10:00. */
const SOUTH = [hour(9, 1000, 1800), hour(10, 2000, 2600), hour(11, 1000, 1500)];

/** Answers each of `series` on the inverter with its rollups, whatever period is asked for. */
const inverter =
  (series: Readonly<Record<string, readonly Readonly<{ start: string }>[]>>) =>
  (a: Asked): Response | undefined => {
    const points = series[a.series];

    if (a.device !== INVERTER || points === undefined) return undefined;

    return Response.json({
      points: points.filter((p) => p.start >= a.from && p.start < a.to),
      period: a.period,
    });
  };

async function sheetOf(id: string, name: string, route = "") {
  const { screen } = await show(id, route);
  const sheet = screen.getByRole("dialog", { name });

  await expect.element(sheet).toBeVisible();

  return sheet;
}

test("the facts row states the range's peak with its hour", async () => {
  served.rolled = inverter({ "pv.string.power[1]": SOUTH });

  const sheet = await sheetOf("string-1", "Süd");
  const peak = sheet.getByRole("definition").filter({ hasText: "10:00–11:00 Uhr" });

  await expect.element(peak).toHaveTextContent("2,6 kW 10:00–11:00 Uhr");
});

test("past a day the peak names its day", async () => {
  served.rolled = inverter({
    "pv.string.power[1]": [hour(0, 9000, 2100, "2026-11-10"), hour(0, 8000, 3100, "2026-11-11")],
  });

  const sheet = await sheetOf("string-1", "Süd", "range=week");
  const peak = sheet.getByRole("definition").filter({ hasText: "11. Nov." });

  await expect.element(peak).toHaveTextContent("3,1 kW 11. Nov.");
});

test("the facts row sets the range's forecast against what was measured", async () => {
  served.rolled = inverter({ "pv.string.power[1]": SOUTH });

  const sheet = await sheetOf("string-1", "Süd");
  const forecast = sheet.getByRole("definition").filter({ hasText: "erreicht" });

  // 4 kWh made of the 8 kWh its inverter forecasts for the string today.
  await expect.element(forecast).toHaveTextContent("8,0 kWh 50 % erreicht");
});

test("the forecast fact reads the whole range, past today", async () => {
  const sheet = await sheetOf("string-1", "Süd", "range=week");

  await expect.element(sheet.getByRole("term").filter({ hasText: "Prognose" })).toBeVisible();
  expect(fetched).toContain(
    "/api/v1/devices/1/forecasts pv.string.power[1] 2026-11-09T00:00:00.000Z",
  );
});
