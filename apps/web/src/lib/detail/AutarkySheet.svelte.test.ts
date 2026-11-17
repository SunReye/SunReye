// The autarky and self-consumption sheet (ADR 21 "Sheet content"): when the house ran on its own
// power, over the sheet's range.
import { afterEach, beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import "../../app.css";
import { PLANT, prepare, restore, rollup, served, show, type Asked } from "./detail.harness.ts";

beforeEach(prepare);

afterEach(restore);

/** Each plant series' power in W by the UTC hour it starts. */
type Flows = Readonly<Partial<Record<string, Readonly<Record<string, number>>>>>;

/** The plant's flows as hourly rollups, whatever period is asked for. */
const plant =
  (flows: Flows) =>
  (a: Asked): Response | undefined => {
    if (a.device !== PLANT) return undefined;

    const [from, to] = [Date.parse(a.from), Date.parse(a.to)];

    const points = Object.entries(flows[a.series] ?? {})
      .map((e: readonly [string, number]) => [Date.parse(e[0]), e[1]] as const)
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
const DAYS = {
  "load.power": {
    ...hours(TODAY, [8, 9, 10, 11], 1000),
    ...hours(YESTERDAY, [8, 9, 10, 11], 1000),
  },
  "self.supply.power": { ...hours(TODAY, [10, 11], 1000), ...hours(YESTERDAY, [11], 1600) },
} satisfies Flows;

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

/**
 * Today: the battery covers 08:00, the grid 09:00, PV 10:00 and 11:00 while it charges the battery
 * and feeds in; yesterday PV covered 11:00 alone.
 */
const FULL = {
  "load.power": {
    ...hours(TODAY, [8, 9, 10, 11], 1000),
    ...hours(YESTERDAY, [8, 9, 10, 11], 1000),
  },
  "self.supply.power": { ...hours(TODAY, [8, 10, 11], 1000), ...hours(YESTERDAY, [11], 1000) },
  "grid.import.power": hours(TODAY, [9], 1000),
  "battery.discharge.power": hours(TODAY, [8], 1000),
  "pv.power": { ...hours(TODAY, [10], 3000), ...hours(TODAY, [11], 2000) },
  "self.consumption.power": { ...hours(TODAY, [10], 2000), ...hours(TODAY, [11], 1000) },
  "grid.export.power": hours(TODAY, [10, 11], 1000),
  "battery.charge.power": hours(TODAY, [10], 1000),
} satisfies Flows;

/** The chart's plot, which the pointer reads. */
const plot = () => document.querySelector<HTMLElement>("[data-plot]")!;

/** A point over the middle of the day's `hour`, in the plot's own box. */
function over(hour: number) {
  const box = plot().getBoundingClientRect();

  return { x: (box.width * (hour + 0.5)) / 24, y: box.height / 2 };
}

test("the pointer reads an hour's autarky and self-consumption in the rows' headers", async () => {
  served.rolled = plant(FULL);

  const { sheet } = await sheetOf();
  const chart = sheet.getByRole("figure");

  await expect.element(chart.getByText("Je Stunde")).toBeVisible();
  await userEvent.hover(plot(), { position: over(10) });

  await expect.element(chart.getByText("10:00–11:00 Uhr")).toBeVisible();
  await expect.element(chart.getByText("100 %")).toBeVisible();
  await expect.element(chart.getByText("67 %")).toBeVisible();

  // An hour without PV has no self-consumption, never 0 %.
  await userEvent.hover(plot(), { position: over(9) });
  await expect.element(chart.getByText("9:00–10:00 Uhr")).toBeVisible();
  await expect.element(chart.getByText("0 %")).toBeVisible();
  await expect.element(chart.getByText("–", { exact: true })).toBeVisible();
});

test("two bars say what covered the house and where the PV went", async () => {
  served.rolled = plant(FULL);

  const { sheet } = await sheetOf();
  const covered = sheet.getByRole("group", { name: "Was den Hausverbrauch deckte" });
  const went = sheet.getByRole("group", { name: "Wohin der PV-Strom ging" });

  await expect.element(covered.getByText("direkt aus PV 50 %")).toBeVisible();
  await expect.element(covered.getByText("aus Batterie 25 %")).toBeVisible();
  await expect.element(covered.getByText("aus dem Netz 25 %")).toBeVisible();
  await expect.element(went.getByText("ins Haus 40 %")).toBeVisible();
  await expect.element(went.getByText("in die Batterie 20 %")).toBeVisible();
  await expect.element(went.getByText("ins Netz 40 %")).toBeVisible();
});

test("the facts name the best and the worst hour and the 30-day average", async () => {
  served.rolled = plant(FULL);

  const { sheet } = await sheetOf();
  const facts = sheet.getByRole("definition");

  await expect.element(sheet.getByText("Am besten")).toBeVisible();
  await expect
    .element(facts.filter({ hasText: "8:00–9:00 Uhr" }))
    .toHaveTextContent("100 % 8:00–9:00 Uhr");
  await expect.element(sheet.getByText("Am schwächsten")).toBeVisible();
  await expect
    .element(facts.filter({ hasText: "9:00–10:00 Uhr" }))
    .toHaveTextContent("0 % 9:00–10:00 Uhr");
  await expect.element(sheet.getByText("Ø 30 Tage")).toBeVisible();
  await expect.element(facts.filter({ hasText: "25 %" })).toBeVisible();
});

test("a refused read says so in place of the range, never 0 %", async () => {
  served.rolled = (a) =>
    a.series === "self.supply.power" && a.period === "hour"
      ? Response.json({ status: 500, code: "store.failed" }, { status: 500 })
      : plant(FULL)(a);

  const { sheet } = await sheetOf();

  await expect
    .element(sheet.getByRole("alert").getByText("Dieser Zeitraum konnte nicht gelesen werden."))
    .toBeVisible();
  expect(sheet.getByRole("figure").elements()).toHaveLength(0);
});
