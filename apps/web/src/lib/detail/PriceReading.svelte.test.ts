import { tick } from "svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import "../../app.css";
import { prepare, restore, show } from "./detail.harness.ts";

beforeEach(prepare);

afterEach(restore);

/** The price chart's plot, which the pointer reads. */
const plot = () => document.querySelector<HTMLElement>("[data-plot]")!;

/** A point over the middle of the day's `hour`, in the plot's own box. */
function over(hour: number) {
  const box = plot().getBoundingClientRect();

  return { x: (box.width * (hour + 0.5)) / 24, y: box.height / 2 };
}

/** A finger's event over `hour`, `dy` px below where it went down. */
function finger(type: string, hour: number, dy = 0): void {
  const box = plot().getBoundingClientRect();
  const { x, y } = over(hour);

  plot().dispatchEvent(
    new PointerEvent(type, {
      pointerType: "touch",
      pointerId: 7,
      clientX: box.left + x,
      clientY: box.top + y + dy,
      buttons: 1,
      bubbles: true,
    }),
  );
}

/** Where the rule stands, in % of the day; null with none. */
const ruleAt = () => {
  const rule = plot().querySelector<HTMLElement>("[data-read]");

  return rule ? Number(rule.style.left.replace("%", "")) : null;
};

test("the pointer over the prices reads its hour's price, and leaving restores the chart's name", async () => {
  const { screen } = await show("price");
  const sheet = screen.getByRole("dialog", { name: "Spotpreis" });
  const legend = sheet.getByRole("figure").getByText("Spotpreise heute");

  await expect.element(legend).toBeVisible();
  expect(ruleAt()).toBeNull();

  await userEvent.hover(plot(), { position: over(12) });

  await expect.poll(ruleAt).toBeCloseTo((12.5 / 24) * 100, 1);
  // The hour's quarter hours averaged, in the legend: no tooltip floats.
  await expect.element(sheet.getByText("12:00–13:00 Uhr")).toBeVisible();
  await expect.element(sheet.getByText("9,38 ct/kWh")).toBeVisible();
  expect(legend.query()).toBeNull();
  expect(document.querySelector('[role="tooltip"]')).toBeNull();

  // An hour without a price reads none, never 0.
  await userEvent.hover(plot(), { position: over(5) });
  await expect.element(sheet.getByText("5:00–6:00 Uhr")).toBeVisible();
  await expect.element(sheet.getByText("–", { exact: true })).toBeVisible();

  await userEvent.hover(sheet.getByRole("link", { name: "CC BY 4.0" }));

  await expect.element(legend).toBeVisible();
  expect(ruleAt()).toBeNull();
});

test("a finger held on the prices reads them and follows; lifted, the chart rests", async () => {
  const { screen } = await show("price");
  const sheet = screen.getByRole("dialog", { name: "Spotpreis" });

  await expect.element(sheet.getByText("Spotpreise heute")).toBeVisible();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  finger("pointerdown", 13);
  await tick();
  expect(ruleAt()).toBeNull();

  vi.advanceTimersByTime(1000);
  await tick();
  expect(ruleAt()).toBeCloseTo((13.5 / 24) * 100, 1);
  await expect.element(sheet.getByText("-1,00 ct/kWh")).toBeVisible();

  finger("pointermove", 0);
  await tick();
  await expect.element(sheet.getByText("12,00 ct/kWh")).toBeVisible();

  finger("pointerup", 0);
  await tick();
  expect(ruleAt()).toBeNull();
  await expect.element(sheet.getByText("Spotpreise heute")).toBeVisible();
});
