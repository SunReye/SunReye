import { expect, onTestFinished, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
// The chart is laid out by the SPA's utilities.
import "../../app.css";
import { connect } from "../api/core.ts";
import { locales, setLocale } from "../paraglide/runtime.js";
import ForecastScreen from "./ForecastScreen.svelte";

import {
  card,
  DAY,
  legendValue,
  PAST_WEEK,
  testCore,
  WEEK,
  type Plant,
} from "./forecast.harness.ts";

test("each inverter's chart reads its total's forecast and measurement over the range", async () => {
  const transport = testCore(WEEK);

  await render(ForecastScreen, { core: connect(transport), ...PAST_WEEK });

  await expect
    .poll(() => [...new Set(transport.asked)].toSorted())
    .toEqual([
      "/api/v1/devices/1/forecasts pv.power",
      "/api/v1/devices/1/statistics pv.mppt.power[1]",
      "/api/v1/devices/1/statistics pv.mppt.power[2]",
      "/api/v1/devices/1/statistics pv.power",
      "/api/v1/devices/1/statistics pv.string.power[4]",
      "/api/v1/devices/1/statistics pv.string.power[5]",
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
  // Device 2 has one MPPT input, so its total is one measured bar.
  await expect.poll(() => legendValue(2, "gemessen")).toBe("30,0 kWh");
  await expect.poll(() => legendValue(2, "Prognose")).toBe("36,0 kWh");

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

  await expect.element(card(1).getByText(/erwartet die Prognose 12,0\skWh\./u)).toBeVisible();
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

  // Device 2 has one MPPT input, so its total is one measured bar.
  const terms = card(2).getByRole("term");

  await Promise.all(
    ["gemessen", "Prognose", "noch erwartet"].map((name) =>
      expect.element(terms.filter({ hasText: new RegExp(`^${name}$`, "u") })).toBeVisible(),
    ),
  );

  // Unmeasured past days are hatched, and named, unless the month starts yesterday.
  if (new Date(today - DAY).getUTCDate() > 1)
    await expect.element(terms.filter({ hasText: "keine Daten" })).toBeVisible();

  await expect.element(card(2).getByText(/Die Prognose reicht zwei Tage voraus/u)).toBeVisible();
});

test("an inverter's total stacks its MPPT inputs, a shared input split into its estimated strings", async () => {
  await render(ForecastScreen, { core: connect(testCore(WEEK)), ...PAST_WEEK });

  const terms = card(1).getByRole("term");
  const term = (name: string) => terms.filter({ hasText: new RegExp(`^${name}$`, "u") });

  // South and north share input 1, so the core estimates each; east has input 2 alone.
  await Promise.all(
    ["south ≈", "north ≈", "MPPT 2"].map((name) => expect.element(term(name)).toBeVisible()),
  );
  await expect.element(term("MPPT 1")).not.toBeInTheDocument();
  await expect.element(term("gemessen")).not.toBeInTheDocument();

  const swatch = (name: string) =>
    getComputedStyle(term(name).element().previousElementSibling ?? term(name).element())
      .backgroundColor;

  expect(new Set(["south ≈", "north ≈", "MPPT 2"].map((name) => swatch(name))).size).toBe(3);
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
