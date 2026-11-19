// The frame every measured sheet shares (ADR 21): its head figure over the range against the
// range before, and its empty, loading, partial and error states.
import { afterEach, beforeEach, expect, test } from "vitest";
import "../../app.css";
import { settled } from "./flows.harness.ts";
import {
  asked,
  PLANT,
  prepare,
  restore,
  rollup,
  served,
  show,
  type Asked,
} from "./detail.harness.ts";

beforeEach(prepare);

afterEach(restore);

/** The plant's PV made `watts` from 10:00 to 11:00 UTC on each day named. */
const pv =
  (days: Readonly<Record<string, number>>) =>
  (a: Asked): Response | undefined => {
    if (a.device !== PLANT || a.series !== "pv.power") return undefined;

    const day = a.from.slice(0, 10);
    const watts = days[day];
    const points = watts === undefined ? [] : [rollup(Date.parse(`${day}T10:00:00Z`), watts)];

    return Response.json({ points, period: "hour" });
  };

/** The sheet named `name` and its head. */
async function sheetOf(id: string, name: string, route = "") {
  const { screen } = await show(id, route);
  const sheet = screen.getByRole("dialog", { name });

  await expect.element(sheet).toBeVisible();

  return { sheet, head: sheet.getByRole("banner") };
}

test("the head states the range's energy against the range before it, as far as it has run", async () => {
  served.rolled = pv({ "2026-11-12": 4000, "2026-11-11": 5000 });

  const { head } = await sheetOf("production", "Produktion");

  await expect.element(head.getByText("4,0 kWh")).toBeVisible();
  await expect.element(head.getByText("−20 % vs gestern")).toBeVisible();
  await expect.element(head.getByText("Heute")).toBeVisible();
  // Yesterday is compared up to the hour today has reached.
  expect(asked).toContainEqual({
    device: PLANT,
    series: "pv.power",
    from: "2026-11-11T00:00:00.000Z",
    to: "2026-11-11T12:00:00.000Z",
    period: "hour",
  });
  // Once: the catalog's answer does not read the range again.
  await settled();
  expect(asked.filter((a) => a.to === "2026-11-11T12:00:00.000Z")).toHaveLength(1);
});

test("without readings in the range before, the head states no change", async () => {
  served.rolled = pv({ "2026-11-12": 4000 });

  const { head } = await sheetOf("production", "Produktion");

  await expect.element(head.getByText("4,0 kWh")).toBeVisible();
  expect(head.element().textContent).not.toContain("vs");
});

test("a chart of one series states no number at rest: the head states it", async () => {
  served.rolled = pv({ "2026-11-12": 4000 });

  const { sheet, head } = await sheetOf("production", "Produktion");
  const legend = sheet.getByRole("tabpanel", { name: "Übersicht" }).getByRole("definition");

  await expect.element(head.getByText("4,0 kWh")).toBeVisible();
  // The forecast so far, of 8 kWh from 10:00 to 14:00 at 12:20.
  await expect.element(legend.filter({ hasText: "4,7 kWh" })).toBeVisible();
  expect(legend.filter({ hasText: "4,0 kWh" }).elements()).toHaveLength(0);

  // Titled by its range alone: no sum stands under it.
  const overview = sheet.getByRole("tabpanel", { name: "Übersicht" });

  await expect.element(overview.getByText("Heute", { exact: true })).toBeVisible();
  expect(overview.getByText(/Summe/u).elements()).toHaveLength(0);
});

test("a range before the first reading says so once, and reads nothing", async () => {
  served.stored = { [PLANT]: ["pv.power"] };

  const { sheet } = await sheetOf("production", "Produktion", "range=day&at=2026-11-01");

  await settled();
  asked.length = 0;
  await sheet.getByRole("button", { name: "Früher" }).click();

  const said = sheet.getByText("Vor der Aufzeichnung: sie beginnt am 1. Nov. 2026.");

  await expect.element(said).toBeVisible();
  expect(said.elements()).toHaveLength(1);
  expect(sheet.getByRole("tabpanel").elements()).toHaveLength(0);
  expect(asked.filter((a) => a.series === "pv.power")).toEqual([]);
});

test("a range the record begins in says where, once", async () => {
  served.stored = { [PLANT]: ["pv.power"] };

  const { sheet } = await sheetOf("production", "Produktion", "range=week&at=2026-10-27");

  await expect.element(sheet.getByText("Aufzeichnung ab 1. Nov. 2026")).toBeVisible();
});

test("while the range loads, the head's figure stands in a skeleton", async () => {
  served.rolled = (a) => (a.series === "pv.power" ? new Promise<Response>(() => {}) : undefined);

  const { head } = await sheetOf("production", "Produktion");

  await expect.element(head.getByRole("status")).toBeVisible();
  await expect.element(head.getByText("Heute")).toBeVisible();
});

test("a range whose readings stop says where", async () => {
  served.rolled = pv({ "2026-11-11": 4000 });
  served.stored = { [PLANT]: ["pv.power"] };
  served.last = "2026-11-11T11:00:00Z";

  const { sheet, head } = await sheetOf("production", "Produktion", "range=day&at=2026-11-11");

  await expect.element(head.getByText("4,0 kWh")).toBeVisible();
  await expect.element(sheet.getByText("Messwerte bis 11. Nov., 11:00")).toBeVisible();
});

test("a day whose readings resume after it marks no stop, as a sleeping inverter's", async () => {
  served.rolled = pv({ "2026-11-11": 4000 });
  served.stored = { [PLANT]: ["pv.power"] };

  const { sheet, head } = await sheetOf("production", "Produktion", "range=day&at=2026-11-11");

  await expect.element(head.getByText("4,0 kWh")).toBeVisible();
  await settled();
  expect(sheet.element().textContent).not.toContain("Messwerte bis");
});

test("a running range whose readings run to now marks no stop", async () => {
  served.rolled = (a) =>
    a.device === PLANT && a.series === "pv.power"
      ? Response.json({
          points: [rollup(Date.parse("2026-11-12T12:00:00Z"), 1000)],
          period: "hour",
        })
      : undefined;

  const { head, sheet } = await sheetOf("production", "Produktion");

  await expect.element(head.getByText("1,0 kWh")).toBeVisible();
  expect(sheet.element().textContent).not.toContain("Messwerte bis");
});

const FAILURES = {
  "a lost core": () => Promise.reject(new TypeError("network")),
  "a refusal": () =>
    Promise.resolve(Response.json({ status: 500, code: "store.failed" }, { status: 500 })),
};

for (const [name, fail] of Object.entries(FAILURES))
  test(`a range that fails to read through ${name} says so, and a retry reads it`, async () => {
    // The sheet's hours fail; the dashboard's day read is not the sheet's to answer for.
    served.rolled = (a) => (a.series === "pv.power" && a.period === "hour" ? fail() : undefined);

    const { sheet, head } = await sheetOf("production", "Produktion");
    const alert = sheet.getByRole("alert");

    await settled();
    await expect
      .element(alert.getByText("Dieser Zeitraum konnte nicht gelesen werden."))
      .toBeVisible();
    served.rolled = pv({ "2026-11-12": 4000 });
    await alert.getByRole("button", { name: "Erneut laden" }).click();

    await expect.element(head.getByText("4,0 kWh")).toBeVisible();
    await expect.element(alert).not.toBeInTheDocument();
    await expect.element(sheet.getByRole("tabpanel")).toBeVisible();
  });
