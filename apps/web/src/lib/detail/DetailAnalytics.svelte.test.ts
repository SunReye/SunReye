import { afterEach, beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import "../../app.css";
import { asked, prepare, restore, show } from "./detail.harness.ts";

beforeEach(prepare);

afterEach(restore);

test("a sheet's range steps, and History opens at it", async () => {
  const { screen } = await show("production");
  const sheet = screen.getByRole("dialog", { name: "Produktion" });

  await sheet.getByRole("button", { name: "Früher" }).click();

  await expect
    .element(sheet.getByRole("link", { name: /Im Verlauf öffnen · Gestern/u }))
    .toHaveAttribute("href", "#/history?range=day&at=2026-11-11");
});

test("today's production overlays the inverters' forecast as a dashed curve; another day does not", async () => {
  const { screen } = await show("production");
  const sheet = screen.getByRole("dialog", { name: "Produktion" });
  const overview = sheet.getByRole("tabpanel", { name: "Übersicht" });
  const forecast = overview.getByRole("term").filter({ hasText: "Prognose" });
  const curve = () => overview.element().querySelector("path[stroke-dasharray='3 4']");

  await expect.element(forecast).toBeVisible();
  await expect.element(overview.getByText("8,0 kWh")).toBeVisible();
  await expect.poll(curve).not.toBeNull();
  // The curve replaces the marks and the faint bars.
  expect(overview.element().querySelectorAll(".mark.on, .seg.opacity-30")).toHaveLength(0);

  await sheet.getByRole("button", { name: "Früher" }).click();

  await expect.element(forecast).not.toBeInTheDocument();
  await expect.poll(curve).toBeNull();
});

test("a battery's overview names its charge and discharge sides, never its series id", async () => {
  const { screen } = await show("battery");
  const overview = screen.getByRole("dialog", { name: "Batterie" });

  await expect.element(overview.getByRole("term").filter({ hasText: "Geladen" })).toBeVisible();
  await expect.element(overview.getByRole("term").filter({ hasText: "Entladen" })).toBeVisible();
  await expect.element(overview.getByText("3,0 kWh")).toBeVisible();
  await expect.element(overview.getByText("2,0 kWh")).toBeVisible();
  expect(overview.element().textContent).not.toContain("battery.power");
  expect(
    [...overview.element().querySelectorAll("[aria-label]")].map((e) =>
      e.getAttribute("aria-label"),
    ),
  ).not.toContainEqual(expect.stringContaining("battery.power"));
});

test("a grid that only imported keys its upper side as imported, in the import colour", async () => {
  const { screen } = await show("grid");
  const sheet = screen.getByRole("dialog", { name: "Netz" });
  const key = sheet.getByRole("term").filter({ hasText: "Bezogen" });

  await expect.element(key).toBeVisible();
  expect(key.element().previousElementSibling?.getAttribute("style")).toContain("var(--e-import)");
});

test("the heat tab reads the range's hours and draws them on one canvas", async () => {
  const { screen } = await show("production", "range=month&at=2026-10-01");
  const sheet = screen.getByRole("dialog", { name: "Produktion" });

  await sheet.getByRole("tab", { name: "Heatmap" }).click();

  const grid = sheet.getByRole("group", { name: /Produktion nach Tageszeit/u });

  await expect.element(grid).toBeVisible();
  expect(grid.element().querySelectorAll("canvas")).toHaveLength(1);
  expect(grid.element().querySelectorAll("span[style]").length).toBeLessThan(2);
  await expect
    .poll(() => asked.some((a) => a.series === "pv.power" && a.from === "2026-10-01T00:00:00.000Z"))
    .toBe(true);
  // The scale is the solar token, light to full.
  expect(document.querySelector("[data-heat-scale] span")?.getAttribute("style")).toContain(
    "var(--e-solar)",
  );
});

/** A mouse press, move and release on `el` from column `a` to column `b` of `n`. */
function drag(el: Element, n: number, a: number, b: number): void {
  const box = el.getBoundingClientRect();

  const at = (c: number) => ({
    clientX: box.left + ((c + 0.5) / n) * box.width,
    clientY: box.top + box.height / 2,
    pointerType: "mouse",
    pointerId: 1,
    bubbles: true,
    isPrimary: true,
  });

  el.dispatchEvent(new PointerEvent("pointerdown", { ...at(a), button: 0, buttons: 1 }));
  el.dispatchEvent(new PointerEvent("pointermove", { ...at(b), buttons: 1 }));
  el.dispatchEvent(new PointerEvent("pointerup", { ...at(b), button: 0 }));
  el.dispatchEvent(new MouseEvent("click", { ...at(b), bubbles: true }));
}

test("dragging across the heat grid's days narrows the range to them", async () => {
  const { screen } = await show("production", "range=week");
  const sheet = screen.getByRole("dialog", { name: "Produktion" });

  await sheet.getByRole("tab", { name: "Heatmap" }).click();

  const grid = sheet.getByRole("group", { name: /Produktion nach Tageszeit/u });

  await expect.element(grid).toBeVisible();
  drag(grid.element(), 7, 1, 2);

  await expect
    .element(sheet.getByRole("link", { name: /Im Verlauf öffnen/u }))
    .toHaveAttribute("href", "#/history?range=custom&from=2026-11-10&to=2026-11-11");
});

test("keys select a span of the heat grid's days, which narrows the range", async () => {
  const { screen } = await show("production", "range=week");
  const sheet = screen.getByRole("dialog", { name: "Produktion" });

  await sheet.getByRole("tab", { name: "Heatmap" }).click();

  const grid = sheet.getByRole("group", { name: /Produktion nach Tageszeit/u });

  await expect.element(grid).toBeVisible();
  const el = grid.element();

  if (el instanceof HTMLElement) el.focus();
  // The first arrow lands on the last day; five more reach Tuesday, Shift and an arrow Wednesday.
  await userEvent.keyboard(
    "{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{Shift>}{ArrowRight}{/Shift}{Enter}",
  );

  await expect
    .element(sheet.getByRole("link", { name: /Im Verlauf öffnen/u }))
    .toHaveAttribute("href", "#/history?range=custom&from=2026-11-10&to=2026-11-11");
});

test("the compare tab ranks strings by yield per kWp and flags a weak one", async () => {
  const { screen } = await show("string-2", "range=week");
  const sheet = screen.getByRole("dialog", { name: "Nord" });

  await sheet.getByRole("tab", { name: "Vergleich" }).click();

  const table = sheet.getByRole("table", { name: "Strings im Vergleich" });

  // 10 modules of 300 W: 3 kWp each; 12 and 3 kWh.
  await expect.element(table.getByRole("row", { name: /Süd.*4,0.*85 %/u })).toBeVisible();
  await expect
    .element(table.getByRole("row", { name: /Nord.*1,0/u }))
    .toHaveAttribute("aria-selected", "true");
  await expect.element(sheet.getByText(/−15 % zum Modell/u)).toBeVisible();
  expect(asked.filter((a) => a.series.startsWith("pv.string.power")).map((a) => a.from)).toContain(
    "2026-11-09T00:00:00.000Z",
  );
});
