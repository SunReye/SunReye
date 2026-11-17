// The battery sheet (ADR 21 "Sheet content"): what the battery gave over the sheet's range, how
// full it ran, and how well it kept what it took.
import { afterEach, beforeEach, expect, test } from "vitest";
import { userEvent, type Locator } from "vitest/browser";
import "../../app.css";
import { prepare, restore, served, show } from "./detail.harness.ts";
import { hours, plant } from "./flows.harness.ts";

beforeEach(prepare);

afterEach(restore);

const TODAY = "2026-11-12";
const YESTERDAY = "2026-11-11";

/** Today the battery gave 3.6 kWh, yesterday 2.4 kWh. */
const GAVE = {
  "battery.discharge.power": {
    ...hours(TODAY, [6, 7, 8], 1200),
    ...hours(YESTERDAY, [6, 7], 1200),
  },
};

async function sheetOf(route = "") {
  const { screen } = await show("battery", route);
  const sheet = screen.getByRole("dialog", { name: "Batterie" });

  await expect.element(sheet).toBeVisible();

  return { sheet, head: sheet.getByRole("banner") };
}

test("the head states what the battery discharged over the range, against the day before", async () => {
  served.rolled = plant(GAVE);

  const { head } = await sheetOf();

  await expect.element(head.getByText("3,6 kWh")).toBeVisible();
  await expect.element(head.getByText("Entladen", { exact: true })).toBeVisible();
  await expect.element(head.getByText("+50 % vs gestern")).toBeVisible();
});

test("the heat tab shows when in the day the battery discharges", async () => {
  served.rolled = plant(GAVE);

  const { sheet } = await sheetOf();

  await sheet.getByRole("tab", { name: "Heatmap" }).click();

  await expect
    .element(sheet.getByRole("group", { name: /Entladen nach Tageszeit/u }))
    .toBeVisible();
});

/**
 * Today it charged 4 kWh from 10:00 and gave 3.6 kWh in the morning, half full at both ends of
 * the day, a 5 kWh battery.
 */
const DAY = {
  ...GAVE,
  "battery.power": { ...hours(TODAY, [6, 7, 8], -1200), ...hours(TODAY, [10, 11], 2000) },
  "battery.charge.power": hours(TODAY, [10, 11], 2000),
  "battery.soc": { ...hours(TODAY, [6], 50), ...hours(TODAY, [7], 60), ...hours(TODAY, [8], 40) },
  "battery.capacity": hours(TODAY, [6, 7, 8, 11], 5),
};

/** The text under fact `label` of the sheet's facts row. */
function fact(sheet: Readonly<Locator>, label: string): string {
  const term = sheet.getByRole("term").filter({ hasText: label }).elements()[0];

  return term?.nextElementSibling?.textContent.replaceAll(/\s+/gu, " ").trim() ?? "";
}

/** A point over the middle of band `at` of the day's 24 in `plot`. */
function over(plot: Element, at: number) {
  const box = plot.getBoundingClientRect();

  return { x: (box.width * (at + 0.5)) / 24, y: box.height / 2 };
}

test("the state of charge runs as a line under the power, and reads where the power is read", async () => {
  served.rolled = plant({
    ...DAY,
    "battery.soc": { ...DAY["battery.soc"], ...hours(TODAY, [11], 50) },
  });

  const { sheet } = await sheetOf();
  const soc = sheet.getByRole("group", { name: "Ladezustand" });

  await expect.element(soc).toBeVisible();
  // The power's plot, read by the pointer.
  const power = sheet.element().querySelector("[data-scrub]")!;

  await userEvent.hover(power, { position: over(power, 7) });
  await expect.element(soc.getByText("60 %")).toBeVisible();

  const line = soc.element().querySelector("[data-plot]")!;

  await userEvent.hover(line, { position: over(line, 8) });
  await expect.element(soc.getByText("40 %")).toBeVisible();
});

test("the facts state the round-trip efficiency and the range's full cycles", async () => {
  served.rolled = plant({
    ...DAY,
    "battery.soc": { ...DAY["battery.soc"], ...hours(TODAY, [11], 50) },
  });

  const { sheet } = await sheetOf();

  await expect.poll(() => fact(sheet, "Wirkungsgrad")).toBe("90 %");
  await expect.poll(() => fact(sheet, "Vollzyklen")).toBe("0,7");
});

test("an efficiency that would pass 100 % is not stated", async () => {
  // It ends at 70 %: 1 kWh of the 4 it took is still in it, and 3.6 kWh of 3 would be 120 %.
  served.rolled = plant({
    ...DAY,
    "battery.soc": { ...DAY["battery.soc"], ...hours(TODAY, [11], 70) },
  });

  const { sheet } = await sheetOf();

  await expect.poll(() => fact(sheet, "Vollzyklen")).toBe("0,7");
  expect(fact(sheet, "Wirkungsgrad")).toContain("––");
});
