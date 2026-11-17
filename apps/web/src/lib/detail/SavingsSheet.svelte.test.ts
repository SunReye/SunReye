// The savings sheet (ADR 21 "Sheet content", ADR 12): what the plant has earned over the range,
// its parts, the total since installation against the investment, and the way to the tariff.
import { afterEach, beforeEach, expect, test } from "vitest";
import "../../app.css";
import { LIVE, prepare, restore, rollup, served, show, TARIFF, type Asked } from "./detail.harness.ts";

beforeEach(async () => {
  await prepare();
  // A tariff is in force.
  served.live = { ...LIVE, [TARIFF]: { "price.import": 0.3, "price.export": 0.08 } };
});

afterEach(restore);

/** The tariff saved `euros` from 10:00 to 11:00 UTC on each day named. */
const saved =
  (days: Readonly<Record<string, number>>) =>
  (a: Asked): Response | undefined => {
    if (a.device !== TARIFF || a.series !== "cost.savings.rate") return undefined;

    const day = a.from.slice(0, 10);
    const euros = days[day];
    const points = euros === undefined ? [] : [rollup(Date.parse(`${day}T10:00:00Z`), euros)];

    return Response.json({ points, period: "hour" });
  };

async function sheetOf(route = "", admin = false) {
  const { screen } = await show("saved", route, admin);
  const sheet = screen.getByRole("dialog", { name: "Ersparnis" });

  await expect.element(sheet).toBeVisible();

  return { sheet, head: sheet.getByRole("banner") };
}

test("the head states the euros saved over the range against the range before", async () => {
  served.rolled = saved({ "2026-11-12": 1.5, "2026-11-11": 2 });

  const { head } = await sheetOf();

  await expect.element(head.getByText("1,50")).toBeVisible();
  await expect.element(head.getByText("−25 % vs gestern")).toBeVisible();
  expect(head.element().textContent).toContain("€");
});

test("the head's figure is the range's alone: today's euros are not repeated beside it", async () => {
  // The dashboard's day reads 2,10 € saved.
  served.rolled = saved({ "2026-11-12": 1.5 });

  const { head } = await sheetOf();

  await expect.element(head.getByText("1,50")).toBeVisible();
  expect(head.element().textContent).not.toContain("2,10");
});
