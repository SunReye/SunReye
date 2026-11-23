import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
// The pane is laid out by the SPA's utilities.
import "../../app.css";
import { haptics } from "@sunreye/ui/haptics";
import { fold, plant, reset } from "./fold.harness.ts";

afterEach(reset);

const desk = () => page.viewport(1280, 800);

/** The table's first column, top to bottom. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a locator.
const periods = (table: { element: () => Element }) =>
  Array.from(table.element().querySelectorAll("tbody th"), ({ textContent }) => textContent.trim());

test("a month folds by day: a row per day with statistics, its energy the core's integral", async () => {
  await desk();

  const { screen } = await fold("pv.power");
  const table = screen.getByRole("table", { name: "Statistik je Zeitraum" });

  await expect.element(table.getByRole("row", { name: /^Do\., 1\. Oktober/u })).toBeVisible();
  expect(periods(table)).toEqual(["Do., 1. Oktober", "Sa., 3. Oktober", "So., 4. Oktober"]);
  expect(plant.asked.map((q: Readonly<URLSearchParams>) => q.get("period"))).toEqual(["day"]);
  expect(plant.asked[0]?.get("from")).toBe("2026-10-01T00:00:00.000Z");
  expect(plant.asked[0]?.get("to")).toBe("2026-11-01T00:00:00.000Z");

  // 9,600 Wh of integral, as the core summed it.
  const first = table.getByRole("row", { name: /^Do\., 1\. Oktober/u });

  await expect.element(first.getByRole("cell").nth(0)).toHaveTextContent("400");
  await expect.element(first.getByRole("cell").nth(1)).toHaveTextContent("0");
  await expect.element(first.getByRole("cell").nth(2)).toHaveTextContent("3.000");
  await expect.element(first.getByRole("cell").nth(3)).toHaveTextContent("9,6");
  await expect.element(first.getByRole("cell").nth(4)).toHaveTextContent("24");
  expect(table.getByRole("columnheader", { name: /Energie/u }).element().textContent).toContain(
    "(kWh)",
  );
  await expect.element(screen.getByRole("radio", { name: "Tagen", exact: true })).toBeChecked();
  await expect
    .element(screen.getByRole("img", { name: "PV · Leistung je Zeitraum" }))
    .toBeVisible();
});

test("the table sorts by a column, and the other way on a second press", async () => {
  const selection = vi.spyOn(haptics, "selection");

  await desk();

  const { screen } = await fold("pv.power");
  const table = screen.getByRole("table", { name: "Statistik je Zeitraum" });
  const mean = table.getByRole("columnheader", { name: /Mittel/u });

  await expect
    .element(table.getByRole("columnheader", { name: /Zeitraum/u }))
    .toHaveAttribute("aria-sort", "ascending");

  await table.getByRole("button", { name: "Nach Mittel sortieren" }).click();

  await expect.element(mean).toHaveAttribute("aria-sort", "descending");
  expect(periods(table)).toEqual(["Do., 1. Oktober", "So., 4. Oktober", "Sa., 3. Oktober"]);

  await table.getByRole("button", { name: "Nach Mittel sortieren" }).click();

  await expect.element(mean).toHaveAttribute("aria-sort", "ascending");
  expect(periods(table)).toEqual(["Sa., 3. Oktober", "So., 4. Oktober", "Do., 1. Oktober"]);
  // Each press ticks once.
  expect(selection).toHaveBeenCalledTimes(2);
  selection.mockRestore();

  await table.getByRole("button", { name: "Nach Max sortieren" }).click();

  await expect
    .element(table.getByRole("columnheader", { name: /Max/u }))
    .toHaveAttribute("aria-sort", "descending");
  expect(periods(table)).toEqual(["So., 4. Oktober", "Do., 1. Oktober", "Sa., 3. Oktober"]);
});

test("a counter folds into its delta per period", async () => {
  await desk();

  const { screen } = await fold("grid.import.energy");
  const table = screen.getByRole("table", { name: "Statistik je Zeitraum" });
  const first = table.getByRole("row", { name: /^Do\., 1\. Oktober/u });

  await expect.element(first.getByRole("cell")).toHaveTextContent("12,5");
  expect(table.getByRole("columnheader", { name: /Zuwachs/u }).element().textContent).toContain(
    "(kWh)",
  );
  expect(table.getByRole("columnheader").elements()).toHaveLength(2);
});

test("a measurement whose integral is no energy has no energy column", async () => {
  await desk();

  const { screen } = await fold("battery.temperature");
  const table = screen.getByRole("table", { name: "Statistik je Zeitraum" });

  await expect.element(table.getByRole("columnheader", { name: /Mittel/u })).toBeVisible();
  expect(table.getByRole("columnheader", { name: /Energie/u }).query()).toBeNull();
});

test("a cost rate's integral is a sum of money, not energy", async () => {
  await desk();

  const { screen } = await fold("cost.import");
  const table = screen.getByRole("table", { name: "Statistik je Zeitraum" });
  const first = table.getByRole("row", { name: /^Do\., 1\. Oktober/u });

  await expect.element(first.getByRole("cell").nth(3)).toHaveTextContent("2,4");
  expect(table.getByRole("columnheader", { name: /Summe/u }).element().textContent).toContain(
    "(EUR)",
  );
  expect(table.getByRole("columnheader", { name: /Energie/u }).query()).toBeNull();
});

test("a status has no fold: the pane says so and reads nothing", async () => {
  await desk();

  const { screen } = await fold("inverter.status");

  await expect.element(screen.getByText("Kein Falten")).toBeVisible();
  await expect.element(screen.getByText(/ist ein Zustand oder gehaltener Wert/u)).toBeVisible();
  expect(screen.getByRole("table").query()).toBeNull();
  expect(screen.getByRole("radio", { name: "Tagen", exact: true }).query()).toBeNull();
  expect(plant.asked).toEqual([]);
});

test("another period goes into the route and is read", async () => {
  await desk();

  const { screen, went } = await fold("pv.power");

  await screen.getByRole("radio", { name: "Wochen", exact: true }).click();

  await expect.poll(() => plant.asked.at(-1)?.get("period")).toBe("week");
  await expect.poll(() => went.at(-1)).toMatchObject({ by: "week", mode: "fold" });
});

test("the route's period comes back as the fold", async () => {
  await desk();

  const { screen } = await fold("pv.power", "range=month&at=2026-10-15&by=week");

  await expect.element(screen.getByRole("radio", { name: "Wochen", exact: true })).toBeChecked();
  await expect.poll(() => plant.asked.at(-1)?.get("period")).toBe("week");
});

test("refused statistics are said, not drawn as an empty range", async () => {
  await desk();
  plant.refused = true;

  const { screen } = await fold("pv.power");

  await expect
    .element(screen.getByText("Die Statistik konnte nicht geladen werden."))
    .toBeVisible();
  // The core's reason, from its refusal.
  await expect.element(screen.getByText("Dieser Zeitraum ist leer oder zu lang.")).toBeVisible();
  expect(screen.getByRole("table").query()).toBeNull();
});

test("a series the catalog does not list has nothing stored, and the pane says so", async () => {
  await desk();

  const { screen } = await fold("pv.voltage");

  await expect.element(screen.getByText(/nichts aufgezeichnet/u)).toBeVisible();
});

test("the legend reads the day under the pointer, the month between days, and a finger's day stays", async () => {
  await desk();

  const { screen } = await fold("pv.power");
  const chart = screen.getByRole("img", { name: "PV · Leistung je Zeitraum" });

  await expect.element(chart).toBeVisible();

  const box = chart.element().getBoundingClientRect();
  // October has 31 days; a day's middle stands at (day − ½) / 31 of the axis.
  const x = (day: number) => box.left + (box.width * (day - 0.5)) / 31;
  const y = box.top + box.height / 2;

  const point = (type: string, day: number, pointerType = "mouse") => {
    chart
      .element()
      .dispatchEvent(
        new PointerEvent(type, { clientX: x(day), clientY: y, pointerType, bubbles: true }),
      );
  };

  /** The legend's title. */
  const title = () =>
    chart.element().closest("figure")!.querySelector("figcaption span")!.textContent;

  const month = title();

  point("pointermove", 1);
  await expect.poll(title).toContain("1. Oktober");

  // No statistics on the 2nd: the month is read.
  point("pointermove", 2);
  await expect.poll(title).toBe(month);

  point("pointerleave", 2);
  point("pointerdown", 4, "touch");
  point("pointerup", 4, "touch");
  point("pointerleave", 4, "touch");
  await expect.poll(title).toContain("4. Oktober");
});
