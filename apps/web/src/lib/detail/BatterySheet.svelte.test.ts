// The battery sheet (ADR 21 "Sheet content"): what the battery gave over the sheet's range, how
// full it ran, and how well it kept what it took.
import { afterEach, beforeEach, expect, test } from "vitest";
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
