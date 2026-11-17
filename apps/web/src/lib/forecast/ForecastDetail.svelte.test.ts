/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { INPUTS, show, STRINGS } from "./forecast-detail.harness.ts";

/** Each line's name and expected energy, as its bar's row reads. */
const lines = () =>
  [...document.querySelectorAll<HTMLElement>("[data-line]")].map((line) =>
    line.innerText.replaceAll(/\s+/gu, " ").trim(),
  );

/** The figure under `term`, in the group named `group`. */
function figure(group: string, term: string): string | undefined {
  const all = document.querySelectorAll<HTMLElement>(`[data-${group}] dt`);
  const dd = [...all].find((dt) => dt.innerText.trim() === term)?.nextElementSibling;

  return dd instanceof HTMLElement ? dd.innerText.replaceAll(/\s+/gu, " ").trim() : undefined;
}

const headline = () =>
  document.querySelector<HTMLElement>("[data-energy]")?.innerText.replaceAll(/\s+/gu, " ").trim();

test("today heads with what is still to come of the day's total", async () => {
  const { screen } = await show();

  await expect.element(screen.getByRole("tab", { name: "Heute" })).toBeVisible();
  await expect.poll(headline).toBe("3,0 kWh noch heute");
  expect(figure("headline", "Gesamt")).toBe("8,0 kWh");
  // Measured against the forecast, one chart.
  await expect.element(screen.getByRole("img", { name: "Leistung" })).toBeVisible();
  await expect.element(screen.getByText("Prognose", { exact: true })).toBeVisible();
});

test("each string's expected energy is a small bar, the sky stands by three hours", async () => {
  const { screen } = await show();

  await expect.element(screen.getByText("Erwartet je String")).toBeVisible();
  expect(lines()).toEqual(["Süd 4,0 kWh", "Nord 2,0 kWh", "Ost 2,0 kWh"]);
  // Each against the widest bar of the three days: south's 10.5 kWh tomorrow.
  expect(
    [...document.querySelectorAll<HTMLElement>("[data-line] [data-bar]")].map((bar) =>
      Math.round(Number(bar.style.width.replace("%", ""))),
    ),
  ).toEqual([38, 19, 19]);
  // Eight marks over the day, each with the sky's icon.
  expect(document.querySelectorAll("[data-hours] svg.lucide")).toHaveLength(8);
  await expect.poll(() => figure("day-facts", "Sonnenschein")).toBe("3,0 h");
});

test("the best window is the day's three hours that make the most", async () => {
  await show();

  await expect.poll(() => figure("day-facts", "Beste 3 h")).toBe("10–13 Uhr");
  await expect.poll(() => figure("day-facts", "Ertrag darin")).toBe("6,0 kWh");
});

test("today alone says how the forecast holds: so far, and over the whole days before", async () => {
  const { screen } = await show();

  // 3 kWh measured of 5 kWh forecast by 12:30; 15 and 10 kWh against 12 kWh on the days before.
  await expect.poll(() => figure("track", "Heute bisher")).toBe("−40 %");
  expect(figure("track", "Ø Abweichung")).toBe("21 %");
  expect(figure("track", "Ganze Tage")).toBe("2");

  await screen.getByRole("tab", { name: "Sonntag" }).click();

  await expect.poll(() => document.querySelector("[data-track]")).toBeNull();
});

test("as the hour goes on less is still to come, and so far stays as of its read", async () => {
  const { asked, later } = await show();

  await expect.poll(() => figure("track", "Heute bisher")).toBe("−40 %");

  const reads = asked.length;

  await later(15);

  // Half an hour of 2 kW is gone from what is to come.
  await expect.poll(headline).toBe("2,5 kWh noch heute");
  // The measurement is the read's, so its forecast is too.
  expect(figure("track", "Heute bisher")).toBe("−40 %");
  expect(asked).toHaveLength(reads);
});

test("a later day heads with its expected total, its peak and its change against today", async () => {
  const { screen } = await show();

  await screen.getByRole("tab", { name: "Sonntag" }).click();

  await expect.poll(headline).toBe("21,0 kWh erwartet");
  expect(figure("headline", "Spitze · 12:00")).toBe("5,0 kW");
  expect(figure("headline", "zu heute")).toBe("+163 %");
  // The forecast alone.
  await expect.element(screen.getByRole("img", { name: "Prognose" })).toBeVisible();
  expect(lines()).toEqual(["Süd 10,5 kWh", "Nord 5,3 kWh", "Ost 5,3 kWh"]);
  await expect.poll(() => figure("day-facts", "Sonnenschein")).toBe("1,0 h");
  expect(figure("day-facts", "Beste 3 h")).toBe("11–14 Uhr");

  await screen.getByRole("tab", { name: "Montag" }).click();

  await expect.poll(headline).toBe("2,0 kWh erwartet");
  expect(figure("headline", "zu heute")).toBe("−75 %");
});

test("the pointer over the chart reads the quarter hour under it", async () => {
  const { screen } = await show();

  await expect.element(screen.getByRole("img", { name: "Leistung" })).toBeVisible();

  const slots = document.querySelector<HTMLElement>("[data-hours]")!;
  const box = slots.getBoundingClientRect();
  const read = () => slots.querySelector<HTMLElement>("[data-figure]")?.innerText;

  expect(read()).toBeUndefined();

  // 11:15, the 46th quarter of 96.
  await userEvent.hover(slots, { position: { x: (box.width * 45.5) / 96, y: box.height / 2 } });

  await expect.poll(() => read()?.replaceAll(/\s+/gu, " ").trim()).toBe("1,2 kW 2,0 kW 11:15");
  // One rule, at the quarter hour's middle.
  expect(
    Number(document.querySelector<HTMLElement>("[data-read]")?.style.left.replace("%", "")),
  ).toBeCloseTo((45.5 / 96) * 100, 2);

  await userEvent.unhover(slots);
  await expect.poll(read).toBeUndefined();
});

test("each tab links to the Forecast screen on its day", async () => {
  const { screen } = await show();

  await expect
    .element(screen.getByRole("link", { name: "Zur Solarprognose · Heute" }))
    .toHaveAttribute("href", "#/forecast?range=day&at=2026-11-14");

  await screen.getByRole("tab", { name: "Sonntag" }).click();

  await expect
    .element(screen.getByRole("link", { name: "Zur Solarprognose · Sonntag" }))
    .toHaveAttribute("href", "#/forecast?range=day&at=2026-11-15");
});

test("it reads each series once over all three days", async () => {
  const { screen, asked } = await show();

  await expect.element(screen.getByRole("tab", { name: "Heute" })).toBeVisible();

  expect(asked.toSorted()).toEqual(
    [
      "forecasts 1 pv.power",
      ...Object.keys(STRINGS)
        .filter((series) => series !== "pv.power")
        .map((series) => `forecasts 1 ${series}`),
      ...["code", "ghi", "sunshine"].flatMap((role) => [
        `forecasts 4294967295 weather.${role}`,
        `history 4294967295 weather.${role}`,
      ]),
      "statistics 1 pv.power day",
    ].toSorted(),
  );
});

test("without a forecast of its strings a plant shows each MPPT input's", async () => {
  const { screen, asked } = await show(INPUTS);

  await expect.element(screen.getByText("Erwartet je MPPT-Eingang")).toBeVisible();
  expect(lines()).toEqual(["Eingang 1 6,0 kWh", "Eingang 2 2,0 kWh"]);
  expect(asked).toContain("forecasts 1 pv.mppt.power[2]");
});

test("a plant without a forecast says so", async () => {
  const { screen } = await show({});

  await expect.element(screen.getByText("Keine Prognose")).toBeVisible();
  expect(screen.getByRole("tab", { name: "Heute" }).query()).toBeNull();
});
