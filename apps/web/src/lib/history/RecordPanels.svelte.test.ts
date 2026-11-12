import { afterEach, expect, test } from "vitest";
// The screen is laid out by the SPA's utilities.
import "../../app.css";
import { iso } from "../range/calendar.ts";
import { plant, reset, show, TODAY, YEAR, YESTERDAY } from "./statistics.harness.ts";

afterEach(reset);

const DAY = `range=day&at=${YESTERDAY}`;

test("the battery tab shows the core's capacity estimate against the nameplate, with its trend", async () => {
  plant.battery = true;

  const { screen } = await show(`${DAY}&metric=plant&tab=battery`);

  await expect.element(screen.getByText("≈ 9,7 kWh")).toBeVisible();
  await expect.element(screen.getByText("97 % von 10 kWh Nennkapazität")).toBeVisible();
  await expect.element(screen.getByText("−4 %")).toBeVisible();
  await expect.element(screen.getByText("123", { exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("img", { name: "Nutzbare Kapazität der Batterie über die Zeit" }))
    .toBeVisible();
});

test("before a full discharge the battery tab says how a measurement comes about", async () => {
  Object.assign(plant, { battery: true, measured: false });

  const { screen } = await show(`${DAY}&metric=plant&tab=battery`);

  await expect.element(screen.getByText("Noch keine Kapazitätsmessung")).toBeVisible();
  await expect.element(screen.getByText("noch keine Messung")).toBeVisible();
});

test("the years tab lists every year against the same days before, and the records open their range", async () => {
  const { screen, went } = await show(`${DAY}&tab=years`);

  const years = screen.getByRole("region", { name: "Jahre" });

  await expect.element(years.getByText("4.200 kWh")).toBeVisible();
  await expect.element(years.getByText("+20 %")).toBeVisible();
  await expect.element(years.getByText("erstes Jahr")).toBeVisible();
  await expect.element(years.getByText(String(YEAR - 1), { exact: true })).toBeVisible();

  const records = screen.getByRole("region", { name: "Rekorde" });

  await expect.element(records.getByText("61,2 kWh")).toBeVisible();
  await expect.element(records.getByText("9,80 €")).toBeVisible();

  await records.getByRole("button", { name: /^Bester Tag/u }).click();

  await expect.poll(() => went.at(-1)?.patch.at).toBe(iso(TODAY - 100));
  expect(went.at(-1)).toMatchObject({ patch: { range: "day" }, push: true });
});

test("the years of savings read in euros", async () => {
  const { screen } = await show(`${DAY}&metric=money&tab=years`);

  const years = screen.getByRole("region", { name: "Jahre" });

  await expect.element(years.getByText("800 €")).toBeVisible();
  await expect.element(years.getByText("1.100 €")).toBeVisible();
});

test("payback names the month the savings reach the investment, and the card its year", async () => {
  const { screen } = await show(DAY);

  await expect
    .element(screen.getByText("3.000 € von 12.000 € gespart, erreicht voraussichtlich 2033"))
    .toBeVisible();

  const again = await show(`${DAY}&metric=money&tab=payback`);

  await expect
    .element(again.screen.getByText(/^Beim Tempo der letzten zwölf Monate \(1\.200 € im Jahr\)/u))
    .toBeVisible();
  await expect.element(again.screen.getByText("November 2033")).toBeVisible();
  await expect
    .element(again.screen.getByRole("img", { name: "Summierte Ersparnis gegen die Investition" }))
    .toBeVisible();
});

test("under three months of savings payback has no forecast yet", async () => {
  plant.paced = false;

  const { screen } = await show(`${DAY}&metric=money&tab=payback`);

  await expect.element(screen.getByText(/^Eine Prognose folgt nach drei Monaten/u)).toBeVisible();
});
