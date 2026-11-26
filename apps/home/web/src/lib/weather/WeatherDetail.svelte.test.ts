/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { DRY, each, show, WEATHER } from "./weather-detail.harness.ts";
import { motion } from "../../../../../../packages/builder/src/motion/tier.svelte.ts";

// Still: a figure stands at its value at once, where it would roll up to it frame by frame.
beforeEach(() => {
  motion.lowPower = true;
});

afterEach(() => {
  motion.lowPower = false;
});

const bars = (attribute: string) =>
  [...document.querySelectorAll("[data-mm]")].map((b) =>
    b instanceof HTMLElement ? b.dataset[attribute] : undefined,
  );

test("a dry day: each quantity by the hour, sunshine for the day, no snow depth and no visibility", async () => {
  const { screen, devices } = await show({ forecasts: DRY });

  await Promise.all(
    ["Temperatur", "Niederschlag", "Bewölkung", "Wind", "Luftfeuchtigkeit"].map((row) =>
      expect.element(screen.getByRole("img", { name: row, exact: true })).toBeVisible(),
    ),
  );

  await expect.element(screen.getByText("Sonnenschein", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("3,0 h")).toBeVisible();
  // Rows that do not matter are absent, not empty.
  expect(screen.getByText("Schneehöhe").query()).toBeNull();
  expect(screen.getByText("Sichtweite").query()).toBeNull();
  // One bar per hour of today, none of them snow.
  expect(bars("mm")).toEqual(Array.from({ length: 24 }, () => "0"));
  expect(bars("snow").filter((snow) => snow !== undefined)).toEqual([]);
  // The wind blows from the west: its arrows point east.
  expect(document.querySelector<HTMLElement>("[data-wind-from]")?.style.rotate).toBe("90deg");
  // It reads the weather device alone.
  expect(new Set(devices)).toEqual(new Set([WEATHER]));
});

test("the next two days are a tab each", async () => {
  const { screen } = await show({ forecasts: DRY });

  await expect.element(screen.getByRole("tab", { name: "Heute" })).toBeVisible();
  await screen.getByRole("tab", { name: "Sonntag" }).click();

  await expect.element(screen.getByText("1,0 h")).toBeVisible();
  await expect.element(screen.getByRole("tab", { name: "Montag" })).toBeVisible();
});

test("a snowy day: snow bars in their own colour and the snow depth", async () => {
  const { screen } = await show({
    forecasts: {
      ...DRY,
      "weather.code": each((h) => (h >= 6 && h < 9 ? 73 : 3)),
      "weather.precipitation": each((h) => (h >= 6 && h < 9 ? 1.5 : 0)),
      "weather.snowfall": each((h) => (h >= 6 && h < 9 ? 1 : 0)),
      "weather.snow_depth": each((h) => (h < 6 ? 0 : 0.12)),
    },
  });

  await expect.element(screen.getByText("Schneehöhe")).toBeVisible();
  await expect.element(screen.getByText("12 cm")).toBeVisible();
  expect(bars("snow").map((snow, hour) => (snow === undefined ? null : hour))).toEqual(
    Array.from({ length: 24 }, (_, h) => (h >= 6 && h < 9 ? h : null)),
  );
  expect(bars("mm")[6]).toBe("1.5");
  expect(screen.getByText("Sichtweite").query()).toBeNull();
});

test("a foggy day: the visibility of its fog", async () => {
  const { screen } = await show({
    forecasts: {
      ...DRY,
      "weather.code": each((h) => (h < 9 ? 45 : 2)),
      "weather.visibility": each((h) => (h < 9 ? 150 + h * 10 : 20_000)),
    },
  });

  await expect.element(screen.getByText("Sichtweite")).toBeVisible();
  await expect.element(screen.getByText("150 m")).toBeVisible();
  expect(screen.getByText("Schneehöhe").query()).toBeNull();
});

test("past fog has no visibility: the archive stores none", async () => {
  const { screen } = await show({
    history: {
      "weather.code": each((h) => (h < 9 ? 45 : null)),
      "weather.temperature": each(() => 2),
    },
  });

  await expect.element(screen.getByRole("img", { name: "Temperatur", exact: true })).toBeVisible();
  expect(screen.getByText("Sichtweite").query()).toBeNull();
});

test("the clear-sky index lies over the cloud cover for the hours it was measured", async () => {
  const { screen } = await show({
    history: { "weather.clearness": each((h) => (h >= 8 && h < 12 ? 0.6 : null)) },
    forecasts: DRY,
  });

  await expect.element(screen.getByText("Clear-Sky-Index")).toBeVisible();
});

test("without stored weather it says so", async () => {
  const { screen } = await show({});

  await expect.element(screen.getByText("Keine Wetterdaten")).toBeVisible();
  expect(screen.getByRole("img", { name: "Temperatur", exact: true }).query()).toBeNull();
});

test("weather the core refuses fails with its reason, never as no weather", async () => {
  let refused: string | undefined = "forecast.range";

  const stored = {
    forecasts: DRY,
    get refused() {
      return refused;
    },
  };

  const { screen } = await show(stored);
  const failed = screen.getByRole("alert").filter({ hasText: "Wetter nicht geladen" });

  await expect
    .element(failed.getByText("Dieser Prognosezeitraum ist leer oder zu lang."))
    .toBeVisible();
  expect(screen.getByText("Keine Wetterdaten").query()).toBeNull();

  refused = undefined;
  await failed.getByRole("button", { name: "Erneut laden" }).click();

  await expect.element(screen.getByRole("img", { name: "Temperatur", exact: true })).toBeVisible();
});

/** The facts row's cells: each term, its value and where it stands. */
const facts = () =>
  [...document.querySelectorAll<HTMLElement>("dl > div")].map((cell) => ({
    term: cell.querySelector("dt")?.textContent.trim(),
    value: cell.querySelector<HTMLElement>("dd")?.innerText.replaceAll(/\s+/gu, " ").trim(),
    top: Math.round(cell.getBoundingClientRect().top),
    right: cell.getBoundingClientRect().right,
    cut: [...cell.querySelectorAll<HTMLElement>("dt, dd")].some(
      (text) => text.scrollWidth > text.clientWidth,
    ),
  }));

test("today's facts are one row on a narrow phone: the sky now, then the day's", async () => {
  const { screen } = await show({
    forecasts: {
      ...DRY,
      "weather.code": each((h) => (h < 9 ? 45 : 73)),
      "weather.snow_depth": each(() => 0.12),
      "weather.visibility": each((h) => (h < 9 ? 150 : 20_000)),
    },
  });

  await page.viewport(360, 800);
  await expect.element(screen.getByText("Heiter")).toBeVisible();

  expect(document.querySelectorAll("dl")).toHaveLength(1);
  // Polled: the figures follow the read.
  await expect
    .poll(() => facts().map(({ term, value }) => [term, value]))
    .toEqual([
      ["Wetter", "Heiter"],
      ["Sonnenschein", "3,0 h"],
      ["Schneehöhe", "12 cm"],
      ["Sichtweite", "150 m"],
    ]);
  // One line inside the screen, nothing cut short.
  expect(new Set(facts().map((cell) => cell.top)).size).toBe(1);
  expect(Math.max(...facts().map((cell) => cell.right))).toBeLessThanOrEqual(360);
  expect(facts().filter((cell) => cell.cut)).toEqual([]);
});

test("a later day's facts are its own: the sky now is today's", async () => {
  const { screen } = await show({ forecasts: DRY });

  await screen.getByRole("tab", { name: "Sonntag" }).click();

  await expect.element(screen.getByText("1,0 h")).toBeVisible();
  expect(facts().map(({ term }) => term)).toEqual(["Sonnenschein"]);
});
