import { afterEach, beforeEach, expect, test } from "vitest";
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
