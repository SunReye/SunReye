// The savings sheet (ADR 21 "Sheet content", ADR 12): what the plant has earned over the range,
// its parts, the total since installation against the investment, and the way to the tariff.
import { afterEach, beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import "../../app.css";
import {
  fetched,
  LIVE,
  prepare,
  restore,
  rollup,
  served,
  show,
  TARIFF,
  type Asked,
} from "./detail.harness.ts";

beforeEach(async () => {
  await prepare();
  // A tariff is in force.
  served.live = {
    ...LIVE,
    [TARIFF]: { "price.import": 0.3, "price.export": 0.08 },
  };
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

test("the head writes euros as the range's money does: whole from 100 €", async () => {
  served.rolled = saved({ "2026-11-12": 123.4 });

  const { head } = await sheetOf();

  await expect.element(head.getByText("123", { exact: true })).toBeVisible();
  expect(head.element().textContent).not.toContain("123,40");
});

test("the head's figure is the range's alone: today's euros are not repeated beside it", async () => {
  // The dashboard's day reads 2,10 € saved.
  served.rolled = saved({ "2026-11-12": 1.5 });

  const { head } = await sheetOf();

  await expect.element(head.getByText("1,50")).toBeVisible();
  expect(head.element().textContent).not.toContain("2,10");
});

/** Two November days' costs: what was saved, of it feed-in pay, what was paid and the standing charge. */
const NOVEMBER = {
  days: [
    {
      start: "2026-11-10T00:00:00Z",
      end: "2026-11-11T00:00:00Z",
      paid: 0.5,
      earned: 0.75,
      saved: 2,
      standing: 0.3,
    },
    {
      start: "2026-11-11T00:00:00Z",
      end: "2026-11-12T00:00:00Z",
      paid: 0.5,
      earned: 0.5,
      saved: 2.5,
      standing: 0.3,
    },
  ],
  total: { paid: 1, earned: 1.25, saved: 4.5, standing: 0.6 },
};

test("the range's chart shows the euros saved per day, split into avoided purchase and feed-in pay, the purchase left below", async () => {
  served.costs = () => Response.json(NOVEMBER);

  const { sheet } = await sheetOf("range=month&at=2026-11-01");
  const chart = sheet.getByRole("region", { name: "Verlauf" });

  await expect
    .element(chart.getByRole("group", { name: /^Ersparnis über den Zeitraum/u }))
    .toBeVisible();
  await expect.element(chart.getByText("vermiedener Bezug")).toBeVisible();
  // Avoided purchase is what was saved but for the feed-in pay; the standing charge is no part.
  await expect.element(chart.getByText("3,25 €")).toBeVisible();
  await expect.element(chart.getByText("1,25 €")).toBeVisible();
  await expect.element(chart.getByText("Einspeisevergütung")).toBeVisible();
  await expect.element(chart.getByText("1,00 €")).toBeVisible();
  expect(chart.element().textContent).not.toContain("0,60");
});

/** The tariff's rates today, in EUR by the UTC hour: 1,50 € saved at 10:00, a third of it feed-in pay. */
const HOURS = new Map([
  ["cost.savings.rate", { 10: 1.5, 12: 0.5 }],
  ["cost.export.rate", { 10: 0.5 }],
  ["cost.import.rate", { 12: 0.2 }],
]);

/** The tariff's rates by the hour, whatever period is asked for. */
function hourly(a: Asked): Response | undefined {
  const rates = HOURS.get(a.series);

  if (a.device !== TARIFF || rates === undefined) return undefined;

  const points = Object.entries(rates).map((e: readonly [string, number]) =>
    rollup(Date.parse(`2026-11-12T${e[0].padStart(2, "0")}:00:00Z`), e[1]),
  );

  return Response.json({ points, period: "hour" });
}

test("a day's chart reads its savings by the hour, from the tariff's rates", async () => {
  served.rolled = hourly;

  const { sheet } = await sheetOf();
  const chart = sheet.getByRole("region", { name: "Verlauf" });
  const plot = chart.element().querySelector<HTMLElement>("[data-scrub]")!;

  await expect.element(chart.getByText("vermiedener Bezug")).toBeVisible();

  const box = plot.getBoundingClientRect();

  await userEvent.hover(plot, { position: { x: (box.width * 10.5) / 24, y: box.height / 2 } });

  await expect.element(chart.getByText("10:00–11:00 Uhr")).toBeVisible();
  // Avoided purchase is what was saved but for the feed-in pay.
  await expect.element(chart.getByText("1,00 €")).toBeVisible();
  await expect.element(chart.getByText("0,50 €")).toBeVisible();
});

test("without a tariff the sheet says nothing can be saved yet, and the admin is shown where to set one", async () => {
  served.live = LIVE;

  const { sheet } = await sheetOf("", true);

  await expect.element(sheet.getByText("Ohne Tarif gibt es keine Ersparnis.")).toBeVisible();
  await expect
    .element(sheet.getByRole("link", { name: "Tarif festlegen" }))
    .toHaveAttribute("href", "#/settings?group=tariff");
  expect(sheet.getByRole("group", { name: /^Ersparnis über den Zeitraum/u }).elements()).toEqual(
    [],
  );
});

test("a viewer without a tariff is told who sets one", async () => {
  served.live = LIVE;

  const { sheet } = await sheetOf();

  await expect.element(sheet.getByText("Ohne Tarif gibt es keine Ersparnis.")).toBeVisible();
  await expect.element(sheet.getByText(/Der Admin legt ihn/u)).toBeVisible();
  expect(sheet.getByRole("link", { name: "Tarif festlegen" }).elements()).toEqual([]);
});

test("the admin reads the savings since installation against the investment", async () => {
  served.payback = {
    investment: 10_000,
    savings: 2500,
    remaining: 7500,
    pace: 1200,
    reached: "2032-03-31",
    months: [],
  };

  const { sheet } = await sheetOf("range=month&at=2026-11-01", true);
  const facts = sheet.getByRole("definition");

  await expect.element(sheet.getByText("Insgesamt")).toBeVisible();
  await expect.element(facts.getByText("2.500")).toBeVisible();
  await expect.element(facts.getByText("25")).toBeVisible();
  await expect.element(facts.getByText("2032")).toBeVisible();
});

test("without an investment the admin reads the savings so far, and no payback", async () => {
  served.payback = { investment: null, savings: 250, remaining: null, months: [] };

  const { sheet } = await sheetOf("", true);

  await expect.element(sheet.getByText("Insgesamt")).toBeVisible();
  await expect.element(sheet.getByText("keine Investition")).toBeVisible();
});

test("a viewer, who may not read the investment, is not asked for it", async () => {
  const { sheet } = await sheetOf();

  await expect.element(sheet.getByRole("link", { name: /Tarif/u })).toBeVisible();
  expect(fetched.filter((f) => f.startsWith("/api/v1/payback"))).toEqual([]);
  expect(sheet.element().textContent).not.toContain("Insgesamt");
});

test("the sheet links the tariff at its range", async () => {
  const { sheet } = await sheetOf("range=month&at=2026-10-01");

  await expect
    .element(sheet.getByRole("link", { name: "Preise und Kosten im Tarif" }))
    .toHaveAttribute("href", "#/tariff?range=month&at=2026-10-01");
});

test("a refused stream is no missing tariff: the sheet still reads its range", async () => {
  served.refuses = true;
  served.costs = () => Response.json(NOVEMBER);

  const { sheet } = await sheetOf("range=month&at=2026-11-01", true);

  await expect.element(sheet.getByText("vermiedener Bezug")).toBeVisible();
  expect(sheet.element().textContent).not.toContain("Ohne Tarif");
});
