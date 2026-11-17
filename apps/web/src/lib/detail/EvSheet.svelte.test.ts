// The EV and loadpoint sheets (ADR 21 "Sheet content"): what was charged over the sheet's range,
// how much of it PV met, and the sessions it was charged in.
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Locator } from "vitest/browser";
import "../../app.css";
import { LIVE, prepare, restore, rollup, served, show, type Asked } from "./detail.harness.ts";
import { hours, plant, type Flows } from "./flows.harness.ts";

beforeEach(prepare);

afterEach(restore);

const TODAY = "2026-11-12";
const YESTERDAY = "2026-11-11";
const LOADPOINT = "3";

/**
 * Today the car charged 3 kW from 7:00 to 9:00 off the grid and from 10:00 on PV alone, 12 kWh in
 * two sessions; yesterday 8 kWh.
 */
const CHARGED: Flows = {
  "ev.charge.power": {
    ...hours(YESTERDAY, [7, 8], 4000),
    ...hours(TODAY, [7, 8, 10, 11], 3000),
  },
  "load.power": hours(TODAY, [7, 8, 10, 11], 4000),
  "grid.import.power": hours(TODAY, [7, 8], 4000),
};

/** The text under fact `label` of the sheet's facts row. */
function fact(sheet: Readonly<Locator>, label: string): string {
  const term = sheet.getByRole("term").filter({ hasText: label }).elements()[0];

  return term?.nextElementSibling?.textContent.replaceAll(/\s+/gu, " ").trim() ?? "";
}

/** The sheet's sessions, newest first, each as its text. */
function sessions(sheet: Readonly<Locator>): string[] {
  const items = sheet.getByRole("list", { name: "Ladevorgänge" }).getByRole("listitem");

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
  return items.elements().map((e) => e.textContent.replaceAll(/\s+/gu, " ").trim());
}

async function sheetOf(id: string, route = "") {
  const { screen } = await show(id, route);
  const sheet = screen.getByRole("dialog", { name: "E-Auto" });

  await expect.element(sheet).toBeVisible();

  return { sheet, head: sheet.getByRole("banner") };
}

test("the EV sheet heads with what was charged, and lists its sessions and their PV share", async () => {
  served.rolled = plant(CHARGED);

  const { sheet, head } = await sheetOf("ev");

  await expect.element(head.getByText("12,0 kWh")).toBeVisible();
  await expect.element(head.getByText("+50 % vs gestern")).toBeVisible();
  await expect.element(sheet.getByRole("list", { name: "Ladevorgänge" })).toBeVisible();
  expect(sessions(sheet)).toEqual(["10:00–12:00 Uhr 6,0 kWh", "7:00–9:00 Uhr 6,0 kWh"]);
  await expect.poll(() => fact(sheet, "Direkt aus PV")).toBe("50 %");
  expect(fact(sheet, "Ladevorgänge")).toBe("2");
});

/** The loadpoint's own charging power, as hourly rollups. */
const loadpoint =
  (flows: Flows) =>
  (a: Asked): Response | undefined => {
    if (a.device !== LOADPOINT) return plant(flows)(a);

    const points = Object.entries(CHARGED[a.series] ?? {})
      .map((e: readonly [string, number]) => [Date.parse(e[0]), e[1]] as const)
      .filter(([at]) => at >= Date.parse(a.from) && at < Date.parse(a.to))
      .map(([at, watts]) => rollup(at, watts));

    return Response.json({ points, period: "hour" });
  };

test("a loadpoint's sheet reads its own charging power, not the plant's", async () => {
  served.live = {
    ...LIVE,
    [LOADPOINT]: { "ev.charge.power": 3000, "ev.charging": 1 },
  };
  served.rolled = loadpoint({ ...CHARGED, "ev.charge.power": {} });

  const { sheet, head } = await sheetOf(`ev-${LOADPOINT}`);

  await expect.element(head.getByText("12,0 kWh")).toBeVisible();
  await expect.poll(() => sessions(sheet)).toHaveLength(2);
});

test("a range no car charged in says so in place of the sessions", async () => {
  served.rolled = plant({
    ...CHARGED,
    "ev.charge.power": hours(YESTERDAY, [7], 4000),
  });

  const { sheet } = await sheetOf("ev");

  await expect.element(sheet.getByText("In diesem Zeitraum hat kein Auto geladen.")).toBeVisible();
  expect(fact(sheet, "Direkt aus PV")).toContain("–");
});

test("past a day a session names its day", async () => {
  served.rolled = plant(CHARGED);

  const { sheet } = await sheetOf("ev", "range=week");

  await expect.poll(() => sessions(sheet)[2]).toBe("11. Nov., 7:00–9:00 Uhr 8,0 kWh");
});

test("a range whose sessions fail to read says so, with a retry", async () => {
  served.rolled = (a) =>
    a.series === "load.power"
      ? Response.json({ status: 500, code: "store.failed" }, { status: 500 })
      : plant(CHARGED)(a);

  const { sheet, head } = await sheetOf("ev");

  await expect.element(head.getByText("12,0 kWh")).toBeVisible();
  await expect.element(sheet.getByRole("alert")).toBeVisible();
  served.rolled = plant(CHARGED);
  await sheet.getByRole("alert").getByRole("button", { name: "Erneut laden" }).click();
  await expect.poll(() => sessions(sheet)).toHaveLength(2);
});

test("past ten sessions the earlier ones are counted, not listed", async () => {
  const days = Array.from({ length: 12 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);

  served.rolled = plant({
    "ev.charge.power": Object.fromEntries(days.flatMap((d) => Object.entries(hours(d, [7], 3000)))),
  });

  const { sheet } = await sheetOf("ev", "range=month");

  await expect.poll(() => sessions(sheet)).toHaveLength(10);
  await expect.element(sheet.getByText("und 2 frühere")).toBeVisible();
  expect(fact(sheet, "Ladevorgänge")).toBe("12");
});
