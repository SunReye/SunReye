// The PV, inverter and string sheets (ADR 21 "Sheet content"): the range's energy and its peak
// with time, actual against forecast, and the inverter's temperature where its profile maps one.
import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import "../../app.css";
import {
  asked,
  fetched,
  INVERTER,
  PLANT,
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

test("the production sheet's facts follow the range: past a day its peak names its day", async () => {
  const pv = [hour(10, 9000, 4100, "2026-11-10"), hour(10, 8000, 3000, "2026-11-11")];

  served.rolled = (a) =>
    a.device === PLANT && a.series === "pv.power"
      ? Response.json({
          points: pv.filter(
            (p: Readonly<{ start: string }>) => p.start >= a.from && p.start < a.to,
          ),
          period: a.period,
        })
      : undefined;

  const sheet = await sheetOf("production", "Produktion", "range=week");
  const peak = sheet.getByRole("definition").filter({ hasText: "10. Nov." });

  await expect.element(peak).toHaveTextContent("4,1 kW 10. Nov.");
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

test("the inverter's sheet states its range's highest temperature where its profile maps one", async () => {
  served.publishes = ["inverter.temperature"];
  served.rolled = inverter({ "inverter.temperature": [hour(9, 38, 41), hour(11, 47, 52)] });

  const sheet = await sheetOf("inverter", "Wechselrichter");
  const hottest = sheet.getByRole("definition").filter({ hasText: "°C" });

  await expect
    .element(sheet.getByRole("term").filter({ hasText: "Max. Temperatur" }))
    .toBeVisible();
  await expect.element(hottest).toHaveTextContent("52 °C 11:00–12:00 Uhr");
});

test("an inverter whose profile maps no temperature states none", async () => {
  const sheet = await sheetOf("inverter", "Wechselrichter");

  await expect.element(sheet.getByRole("term").filter({ hasText: "Spitze" })).toBeVisible();
  expect(sheet.getByRole("term").filter({ hasText: "Temperatur" }).elements()).toHaveLength(0);
  expect(asked.some((a) => a.series === "inverter.temperature")).toBe(false);
});

test("an estimated string's energy and peak carry ≈; its forecast does not", async () => {
  served.rolled = inverter({ "pv.string.power[1]": SOUTH });

  const sheet = await sheetOf("string-1", "Süd");
  const head = sheet.getByRole("banner");

  await expect.element(head.getByText("4,0")).toBeVisible();
  // The live power's ≈ and the range's.
  expect(head.getByLabelText("geschätzt").elements()).toHaveLength(2);
  await expect.element(sheet.getByRole("term").filter({ hasText: "Spitze ≈" })).toBeVisible();
  expect(sheet.getByRole("term").filter({ hasText: "Prognose ≈" }).elements()).toHaveLength(0);
});

test("under the pointer an estimated string's chart value carries ≈; its forecast does not", async () => {
  const sheet = await sheetOf("string-1", "Süd");
  const overview = sheet.getByRole("tabpanel", { name: "Übersicht" });
  const plot = overview.element().querySelector<HTMLElement>("[data-scrub]")!;
  const box = plot.getBoundingClientRect();

  await userEvent.hover(plot, { position: { x: (box.width * 10.5) / 24, y: box.height / 2 } });

  await expect.element(overview.getByText("≈ 12,0 kWh")).toBeVisible();
  await expect.element(overview.getByText("2,0 kWh", { exact: true })).toBeVisible();
});

test("an estimated string's heat cells carry ≈ too", async () => {
  served.rolled = inverter({ "pv.string.power[1]": SOUTH });

  const sheet = await sheetOf("string-1", "Süd");

  await sheet.getByRole("tab", { name: "Heatmap" }).click();

  const grid = sheet.getByRole("group", { name: /nach Tageszeit/u });

  await expect.element(grid).toBeVisible();
  grid.element().focus();
  // The first arrow reads Sunday at noon; Thursday the 12th at 10:00 is three days and two hours back.
  await userEvent.keyboard("{ArrowUp}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowUp}{ArrowUp}");

  await expect.element(sheet.getByText("· ≈ 2,00 kWh")).toBeVisible();
});

test("the plant's PV, measured whole, carries no ≈", async () => {
  const sheet = await sheetOf("pv", "PV gesamt");

  await expect.element(sheet.getByRole("term").filter({ hasText: "Spitze" })).toBeVisible();
  expect(sheet.getByLabelText("geschätzt").elements()).toHaveLength(0);
  expect(sheet.getByText("≈").elements()).toHaveLength(0);
});

test("a failed temperature read leaves the peak and forecast standing", async () => {
  served.publishes = ["inverter.temperature"];
  served.rolled = (a) =>
    a.series === "inverter.temperature"
      ? Response.json({ status: 500, code: "store.failed" }, { status: 500 })
      : undefined;

  const sheet = await sheetOf("inverter", "Wechselrichter");

  await expect.element(sheet.getByRole("term").filter({ hasText: "Spitze" })).toBeVisible();
  await expect
    .element(sheet.getByRole("term").filter({ hasText: "Max. Temperatur" }))
    .toBeVisible();
  // A dash over the hidden zero that holds its width.
  await expect
    .element(sheet.getByRole("definition").filter({ hasText: "°C" }))
    .toHaveTextContent("0–– °C");
});

test("while the facts read, a skeleton holds their place", async () => {
  served.publishes = ["inverter.temperature"];
  served.rolled = (a) =>
    a.series === "inverter.temperature" ? new Promise<Response>(() => {}) : undefined;

  const sheet = await sheetOf("inverter", "Wechselrichter");

  await expect
    .element(sheet.getByRole("region", { name: "Verlauf" }).getByRole("status"))
    .toBeVisible();
  expect(sheet.getByRole("term").filter({ hasText: "Spitze" }).elements()).toHaveLength(0);
});

test("facts that fail to read say so in their place, with a retry", async () => {
  served.forecasts = () => Promise.reject(new Error("the core is lost"));

  const sheet = await sheetOf("string-1", "Süd");
  const alert = sheet.getByRole("alert");

  await expect.element(alert).toBeVisible();
  served.forecasts = null;
  await alert.getByRole("button", { name: "Erneut laden" }).click();

  await expect.element(sheet.getByRole("term").filter({ hasText: "Spitze" })).toBeVisible();
  await expect.element(alert).not.toBeInTheDocument();
});

test("another string's sheet never shows the last one's facts while it reads", async () => {
  const south = inverter({ "pv.string.power[1]": SOUTH });

  served.rolled = (a) =>
    a.series === "pv.string.power[2]" ? new Promise<Response>(() => {}) : south(a);

  const { screen } = await show("string-1");

  await expect
    .element(screen.getByRole("definition").filter({ hasText: "10:00–11:00 Uhr" }))
    .toBeVisible();
  await screen.rerender({ detail: "string-2" });
  await expect.element(screen.getByRole("dialog", { name: "Nord" })).toBeVisible();

  await expect
    .element(screen.getByRole("definition").filter({ hasText: "10:00–11:00 Uhr" }))
    .not.toBeInTheDocument();
});

test("on a phone the facts' labels and times wrap rather than cut", async () => {
  await page.viewport(390, 844);
  served.publishes = ["inverter.temperature"];
  served.rolled = inverter({ "inverter.temperature": [hour(11, 47, 52)] });

  const sheet = await sheetOf("inverter", "Wechselrichter");
  const hottest = sheet.getByRole("definition").filter({ hasText: "°C" });

  await expect.element(hottest).toHaveTextContent("52 °C 11:00–12:00 Uhr");

  const cut = [...sheet.element().querySelectorAll("dl dt, dl dd span")].filter(
    (e) => e.scrollWidth > e.clientWidth,
  );

  expect(cut.map((e) => e.textContent)).toEqual([]);
});
