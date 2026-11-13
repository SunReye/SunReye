import { expect, onTestFinished, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
// The chart is laid out by the SPA's utilities.
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import { locales, setLocale } from "../paraglide/runtime.js";
import ForecastScreen from "./ForecastScreen.svelte";

const WIRING = { moduleType: 1, modules: 16, optimized: 0, tilt: 35, loss: 2 };

/** The owner's layout: south and north in parallel on device 1's input 1, garage alone on device 2. */
const LAYOUT = {
  appliesFrom: "2026-11-01T00:00:00Z",
  strings: [
    { ...WIRING, id: 4, name: "south", device: 1, input: 1, azimuth: 0 },
    { ...WIRING, id: 5, name: "north", device: 1, input: 1, azimuth: 180 },
    { ...WIRING, id: 7, name: "east", device: 1, input: 2, azimuth: -90 },
    { ...WIRING, id: 6, name: "garage", device: 2, input: 1, azimuth: 0 },
  ],
};

/** South and north share their input, so the core estimates them. */
const CAPABILITIES = {
  version: "5.0.0",
  schema: { min: 1, max: 1 },
  capabilities: [],
  transports: [],
  devices: {
    "1": {
      estimated: ["pv.string.power[4]", "pv.string.power[5]"],
      series: [],
      settings: [],
      writes: false,
    },
    "2": { estimated: [], series: [], settings: [], writes: false },
  },
};

const H = 3_600_000;
const DAY = 24 * H;

/** A day rollup of `kwh` measured over all of it. */
const rolled = (start: number, kwh: number) => ({
  date: new Date(start).toISOString().slice(0, 10),
  start: new Date(start).toISOString(),
  end: new Date(start + DAY).toISOString(),
  integral: kwh * 1000,
  mean: (kwh * 1000) / 24,
  hours: 24,
});

interface Plant {
  /** Day rollups by their UTC midnight. */
  readonly days: readonly (readonly [number, number])[];
  /** The forecast's power, held on every hour of [from, to). */
  readonly forecast: { readonly from: number; readonly to: number; readonly watts: number };
}

/** A test core: the layout, the capabilities, the plant's day rollups and its hourly forecast. */
function testCore(plant: Plant): Transport & { readonly asked: string[] } {
  const asked: string[] = [];

  return {
    base: "http://core.test/",
    asked,
    fetch: (request) => {
      const url = new URL(request.url);

      if (url.pathname.endsWith("/layout")) return Promise.resolve(Response.json(LAYOUT));

      if (url.pathname.endsWith("/capabilities"))
        return Promise.resolve(Response.json(CAPABILITIES));

      if (url.pathname.endsWith("/timezone"))
        return Promise.resolve(Response.json({ name: "UTC" }));

      asked.push(`${url.pathname} ${url.searchParams.get("series") ?? ""}`);

      const from = Date.parse(url.searchParams.get("from") ?? "");
      const to = Date.parse(url.searchParams.get("to") ?? "");

      if (url.pathname.endsWith("/statistics")) {
        const points = plant.days
          .filter(([start]) => start >= from && start < to)
          .map(([start, kwh]) => rolled(start, kwh));

        return Promise.resolve(Response.json({ period: "day", points }));
      }

      const issued = new Date(plant.forecast.from - DAY).toISOString();
      const points = [];

      for (let t = Math.max(from, plant.forecast.from); t < Math.min(to, plant.forecast.to); t += H)
        points.push({ target: new Date(t).toISOString(), issued, value: plant.forecast.watts });

      return Promise.resolve(Response.json({ points }));
    },
  };
}

/** Week 45 of 2026: Monday to Wednesday measured, Thursday forecast but unmeasured. */
const MONDAY = Date.UTC(2026, 10, 2);

const WEEK: Plant = {
  days: [
    [MONDAY, 10],
    [MONDAY + DAY, 12],
    [MONDAY + 2 * DAY, 8],
  ],
  // 500 W around the clock: 12 kWh a day.
  forecast: { from: MONDAY, to: MONDAY + 4 * DAY, watts: 500 },
};

const PAST_WEEK = { params: new URLSearchParams("range=week&at=2026-11-02"), go: () => {} };

const card = (device: number) =>
  page.getByRole("region", { name: device === 1 ? "Wechselrichter 1" : "Wechselrichter 2" });

/** The figure the legend gives a term, as it shows. */
function legendValue(device: number, term: string): string | undefined {
  const dd = card(device)
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${term}$`, "u") })
    .element().nextElementSibling;

  return dd instanceof HTMLElement ? dd.innerText.trim() : undefined;
}

test("each inverter's chart reads its total's forecast and measurement over the range", async () => {
  const transport = testCore(WEEK);

  await render(ForecastScreen, { core: connect(transport), ...PAST_WEEK });

  await expect
    .poll(() => [...new Set(transport.asked)].toSorted())
    .toEqual([
      "/api/v1/devices/1/forecasts pv.power",
      "/api/v1/devices/1/statistics pv.power",
      "/api/v1/devices/2/forecasts pv.power",
      "/api/v1/devices/2/statistics pv.power",
    ]);
});

test("the headline answers the range: produced against the forecast, and how close it came", async () => {
  await render(ForecastScreen, { core: connect(testCore(WEEK)), ...PAST_WEEK });

  await expect
    .element(card(1).getByText("In KW 45 wurden 30,0 kWh erzeugt, 17 % weniger als vorhergesagt."))
    .toBeVisible();
  // The same sums as the chart's legend: measured days against their forecast, not Thursday's.
  await expect.poll(() => legendValue(1, "gemessen")).toBe("30,0 kWh");
  await expect.poll(() => legendValue(1, "Prognose")).toBe("36,0 kWh");

  const figures = card(1).getByRole("definition");

  // Mean deviation per whole day (1/6, 0, 1/3), actual against forecast, whole days.
  await expect.element(figures.filter({ hasText: /^17 %$/u })).toBeVisible();
  await expect.element(figures.filter({ hasText: /^−17 %$/u })).toBeVisible();
  await expect.element(figures.filter({ hasText: /^3$/u })).toBeVisible();
});

test("a range still to come says what the forecast expects", async () => {
  const today = Math.floor(Date.now() / DAY) * DAY;

  const plant: Plant = {
    days: [],
    forecast: { from: today + DAY, to: today + 2 * DAY, watts: 500 },
  };

  const tomorrow = new Date(today + DAY).toISOString().slice(0, 10);

  await render(ForecastScreen, {
    core: connect(testCore(plant)),
    params: new URLSearchParams(`range=day&at=${tomorrow}`),
    go: () => {},
  });

  await expect.element(card(1).getByText(/erwartet die Prognose 12,0 kWh\./u)).toBeVisible();
});

/** Yesterday measured, today forecast and running, tomorrow forecast; the days before unmeasured. */
function thisMonth(): Plant {
  const today = Math.floor(Date.now() / DAY) * DAY;

  return {
    days: [[today - DAY, 10]],
    forecast: { from: today - DAY, to: today + 2 * DAY, watts: 500 },
  };
}

const THIS_MONTH = { params: new URLSearchParams("range=month"), go: () => {} };

test("every state of the month is named on screen", async () => {
  const today = Math.floor(Date.now() / DAY) * DAY;

  await render(ForecastScreen, { core: connect(testCore(thisMonth())), ...THIS_MONTH });

  const terms = card(1).getByRole("term");

  await Promise.all(
    ["gemessen", "Prognose", "noch erwartet"].map((name) =>
      expect.element(terms.filter({ hasText: new RegExp(`^${name}$`, "u") })).toBeVisible(),
    ),
  );

  // Unmeasured past days are hatched, and named, unless the month starts yesterday.
  if (new Date(today - DAY).getUTCDate() > 1)
    await expect.element(terms.filter({ hasText: "keine Daten" })).toBeVisible();

  await expect.element(card(1).getByText(/Die Prognose reicht zwei Tage voraus/u)).toBeVisible();
});

test("lines are picked inverter first, then MPPT input, then string, with estimates marked once", async () => {
  const transport = testCore(WEEK);

  await render(ForecastScreen, { core: connect(transport), ...PAST_WEEK });

  await card(1)
    .getByRole("button", { name: /Gesamt/u })
    .click();

  const menu = page.getByRole("menu");

  await expect.element(menu).toBeVisible();

  await expect.element(menu.getByRole("group", { name: "MPPT 1" })).toBeVisible();
  await expect.element(menu.getByRole("group", { name: "MPPT 2" })).toBeVisible();
  await expect
    .element(
      menu.getByRole("group", { name: "MPPT 1" }).getByRole("menuitemradio", { name: /south/u }),
    )
    .toBeVisible();
  await expect
    .element(
      menu.getByRole("group", { name: "MPPT 2" }).getByRole("menuitemradio", { name: /east/u }),
    )
    .toBeVisible();
  // One explanation for the mark, none repeated on each line.
  await expect.element(menu.getByText(/werden zusammen gemessen/u)).toBeVisible();
  expect(document.body.textContent).not.toContain("geschätzt)");

  await menu.getByRole("menuitemradio", { name: /south/u }).click();

  await expect
    .poll(() => transport.asked)
    .toContain("/api/v1/devices/1/forecasts pv.string.power[4]");
  await expect.element(card(1).getByRole("button", { name: /MPPT 1 · south/u })).toBeVisible();
  // The chart now shows an estimate, and says so.
  await expect.element(card(1).getByText(/werden zusammen gemessen/u)).toBeVisible();
});

const SIZES = locales.flatMap((locale) => [360, 320].map((width) => [width, locale] as const));

test.each(SIZES)(
  "at %i px nothing on the screen overflows or wraps raggedly in %s",
  async (width, locale) => {
    onTestFinished(() => setLocale("de", { reload: false }));
    await setLocale(locale, { reload: false });
    await page.viewport(width, 900);

    const screen = await render(ForecastScreen, {
      core: connect(testCore(thisMonth())),
      ...THIS_MONTH,
    });

    const region = screen.getByRole("region").first();

    const legend = () => region.element().querySelectorAll("[aria-live] dt");

    // Measured, forecast, still expected: the legend at its fullest.
    await expect.poll(() => legend().length).toBeGreaterThanOrEqual(3);

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);

    // The inverter's name and its line picker share one row.
    const title = region.getByRole("heading", { level: 2 }).element().getBoundingClientRect();
    const picker = region.getByRole("button").first().element().getBoundingClientRect();

    expect(picker.top).toBeLessThan(title.bottom);
    expect(picker.bottom).toBeGreaterThan(title.top);

    // The legend's names keep to one line each, whole, and its keys never overlap.
    for (const dt of legend()) {
      expect(dt.getBoundingClientRect().height, dt.textContent).toBeLessThan(20);
      expect(dt.scrollWidth, dt.textContent).toBeLessThanOrEqual(dt.clientWidth);
    }

    // Each key holds its swatch, name and figure inside its own box, so none runs into the next.
    for (const dt of legend()) {
      const key = dt.parentElement!;

      expect(key.scrollWidth, dt.textContent).toBeLessThanOrEqual(key.clientWidth);
    }

    // Every figure fits its cell.
    for (const dd of region.getByRole("definition").elements())
      expect(dd.scrollWidth, dd.textContent).toBeLessThanOrEqual(dd.clientWidth);
  },
);
