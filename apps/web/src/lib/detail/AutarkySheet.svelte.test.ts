// The autarky and self-consumption sheet (ADR 21 "Sheet content"): when the house ran on its own
// power, over the sheet's range.
import { afterEach, beforeEach, expect, test } from "vitest";
import "../../app.css";
import { PLANT, prepare, restore, rollup, served, show, type Asked } from "./detail.harness.ts";

beforeEach(prepare);

afterEach(restore);

/** Each plant series' power in W by the UTC hour it starts. */
type Flows = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** The plant's flows as hourly rollups, whatever period is asked for. */
const plant =
  (flows: Flows) =>
  (a: Asked): Response | undefined => {
    if (a.device !== PLANT) return undefined;

    const [from, to] = [Date.parse(a.from), Date.parse(a.to)];

    const points = Object.entries(flows[a.series] ?? {})
      .map(([at, watts]) => [Date.parse(at), watts] as const)
      .filter(([at]) => at >= from && at < to)
      .map(([at, watts]) => rollup(at, watts));

    return Response.json({ points, period: "hour" });
  };

/** `watts` in each of `hours` on `day`. */
const hours = (day: string, at: readonly number[], watts: number) =>
  Object.fromEntries(at.map((h) => [`${day}T${String(h).padStart(2, "0")}:00:00Z`, watts]));

const TODAY = "2026-11-12";
const YESTERDAY = "2026-11-11";

/** Today the house ran on its own for half its load, yesterday for 40 %. */
const DAYS: Flows = {
  "load.power": { ...hours(TODAY, [8, 9, 10, 11], 1000), ...hours(YESTERDAY, [8, 9, 10, 11], 1000) },
  "self.supply.power": { ...hours(TODAY, [10, 11], 1000), ...hours(YESTERDAY, [11], 1600) },
};

async function sheetOf(route = "") {
  const { screen } = await show("autarky", route);
  const sheet = screen.getByRole("dialog", { name: "Autarkie & Eigenverbrauch" });

  await expect.element(sheet).toBeVisible();

  return { sheet, head: sheet.getByRole("banner") };
}

test("the head states the range's autarky against the day before, in points", async () => {
  served.rolled = plant(DAYS);

  const { head } = await sheetOf();

  await expect.element(head.getByText("50 %")).toBeVisible();
  await expect.element(head.getByText("+10 Pkt. vs gestern")).toBeVisible();
  await expect.element(head.getByText("Heute")).toBeVisible();
  // One figure heads the sheet: today's lead from the dashboard does not stand beside it.
  expect(head.getByText("Autarkie", { exact: true }).elements()).toHaveLength(0);
});
