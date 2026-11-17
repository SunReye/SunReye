// The consumption, house, feed-in, purchase and generator sheets (ADR 21 "Sheet content"): the
// range's peak with its time, the share PV covered the house, what was paid or earned, and the
// price bought by hour.
import { afterEach, beforeEach, expect, test } from "vitest";
import "../../app.css";
import {
  LIVE,
  PLANT,
  prepare,
  restore,
  rollup,
  served,
  show,
  TARIFF,
  type Asked,
} from "./detail.harness.ts";

beforeEach(prepare);

afterEach(restore);

/** A rollup's mean and highest reading. */
type Read = readonly [mean: number, max: number];

/** Per device and series, each hourly rollup by the UTC instant it starts. */
type Served = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, Read>>>>>>;

/** The rollups served, whatever period is asked for. */
const rolled =
  (all: Served) =>
  (a: Asked): Response => {
    const [from, to] = [Date.parse(a.from), Date.parse(a.to)];

    const points = Object.entries(all[a.device]?.[a.series] ?? {})
      .map((e: readonly [string, Read]) => [Date.parse(e[0]), e[1]] as const)
      .filter(([at]) => at >= from && at < to)
      .map(([at, [mean, max]]) => Object.assign(rollup(at, mean), { max }));

    return Response.json({ points, period: "hour" });
  };

const TODAY = "2026-11-12";

/** Today at `hour` UTC, the plant's zone. */
const at = (hour: number) => `${TODAY}T${String(hour).padStart(2, "0")}:00:00Z`;

/** Bought at 08:00 and 09:00, the higher peak at 09:00, for 0,45 € in all. */
const BOUGHT = {
  [PLANT]: { "grid.import.power": { [at(8)]: [1000, 2400], [at(9)]: [500, 3100] } },
  [TARIFF]: { "cost.import.rate": { [at(8)]: [0.3, 0.3], [at(9)]: [0.15, 0.15] } },
} satisfies Served;

/** A tariff is in force. */
function priced(): void {
  served.live = { ...LIVE, [TARIFF]: { "price.import": 0.3, "price.export": 0.08 } };
}

async function sheetOf(id: string, name: string, route = "") {
  const { screen } = await show(id, route);
  const sheet = screen.getByRole("dialog", { name });

  await expect.element(sheet).toBeVisible();

  return sheet;
}

test("the purchase sheet's facts: the range's peak with its hour, and what was paid", async () => {
  priced();
  served.rolled = rolled(BOUGHT);

  const sheet = await sheetOf("purchase", "Bezug");
  const facts = sheet.getByRole("definition");

  await expect.element(sheet.getByText("Spitze")).toBeVisible();
  await expect
    .element(facts.filter({ hasText: "9:00–10:00 Uhr" }))
    .toHaveTextContent("3,1 kW 9:00–10:00 Uhr");
  await expect.element(sheet.getByText("Kosten")).toBeVisible();
  await expect.element(facts.filter({ hasText: "€" })).toHaveTextContent("0,45 €");
});

/** The house drew 1 kW from 08:00 to 12:00: the battery covered 08:00, the grid 09:00. */
const DREW = {
  [PLANT]: {
    "load.power": {
      [at(8)]: [1000, 1800],
      [at(9)]: [1000, 1200],
      [at(10)]: [1000, 4600],
      [at(11)]: [1000, 1100],
    },
    "grid.import.power": { [at(9)]: [1000, 1200] },
    "battery.discharge.power": { [at(8)]: [1000, 1800] },
  },
} satisfies Served;

test("the consumption sheet's facts: the peak with its hour, and the share PV covered directly", async () => {
  served.rolled = rolled(DREW);

  const sheet = await sheetOf("consumption", "Verbrauch");
  const facts = sheet.getByRole("definition");

  await expect
    .element(facts.filter({ hasText: "10:00–11:00 Uhr" }))
    .toHaveTextContent("4,6 kW 10:00–11:00 Uhr");
  // Of 4 kWh, the battery covered one and the grid one: the battery's charge is not counted as PV's.
  await expect.element(sheet.getByText("Direkt aus PV")).toBeVisible();
  await expect.element(facts.filter({ hasText: "%" })).toHaveTextContent("50 %");
  expect(sheet.getByText("Kosten").elements()).toHaveLength(0);
});
