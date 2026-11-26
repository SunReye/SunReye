import { tick } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { DRY, each, show } from "./weather-detail.harness.ts";

afterEach(() => {
  vi.useRealTimers();
});

/** The day's rows, which the pointer reads. */
const rows = () => document.querySelector<HTMLElement>("[data-hours]")!;

/** A point over the middle of the day's `hour`, in the rows' own box. */
function over(hour: number) {
  const box = rows().getBoundingClientRect();

  return { x: (box.width * (hour + 0.5)) / 24, y: box.height / 2 };
}

/** A finger's event over `hour`, `dy` px below where it went down. */
function finger(type: string, hour: number, dy = 0): void {
  const box = rows().getBoundingClientRect();
  const { x, y } = over(hour);

  rows().dispatchEvent(
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

/** Where the rule that marks the read hour stands, in % of the day; null with none. */
const ruleAt = () => {
  const rule = document.querySelector<HTMLElement>("[data-read]");

  return rule ? Number(rule.style.left.replace("%", "")) : null;
};

test("the pointer over a chart reads every row at its hour, and leaving restores the ranges", async () => {
  const { screen } = await show({
    history: { "weather.clearness": each((h) => (h >= 8 && h < 16 ? 0.6 : null)) },
    forecasts: DRY,
  });

  // Off the charts, wherever the pointer was left.
  await userEvent.hover(screen.getByRole("tab", { name: "Heute" }));
  await expect.element(screen.getByText("4 – 10 °C")).toBeVisible();
  expect(ruleAt()).toBeNull();

  await userEvent.hover(rows(), { position: over(14) });

  // One rule across the rows, at the hour's middle.
  await expect.poll(ruleAt).toBeCloseTo((14.5 / 24) * 100, 1);
  // Temperature and feels-like, mm, cloud cover and clear-sky index, wind and gusts, humidity.
  await Promise.all(
    ["7,5 °C", "5,5 °C", "0,0 mm", "30 %", "0,60", "3,0 m/s", "7,0 m/s", "80 %"].map((value) =>
      expect.element(screen.getByText(value, { exact: true })).toBeVisible(),
    ),
  );
  // In place of the ranges.
  expect(screen.getByText("4 – 10 °C").query()).toBeNull();
  // The wind blows from the west: the header's arrow points east.
  expect(document.querySelector<HTMLElement>("[data-figure] [data-wind-from]")?.style.rotate).toBe(
    "90deg",
  );
  // The icon row marks the hour: its slot names it.
  await expect.element(screen.getByText("14:00")).toBeVisible();
  expect(screen.getByText("12:00").query()).toBeNull();
  // No tooltip floats.
  expect(document.querySelector('[role="tooltip"]')).toBeNull();

  // A click reads on.
  await userEvent.click(rows(), { position: over(14) });
  expect(ruleAt()).toBeCloseTo((14.5 / 24) * 100, 1);

  // An hour the index was not measured in has none.
  await userEvent.hover(rows(), { position: over(20) });
  await expect.element(screen.getByText("–", { exact: true })).toBeVisible();

  // Off the charts again, which also leaves the pointer clear of the next test's.
  await userEvent.hover(screen.getByRole("tab", { name: "Heute" }));

  await expect.element(screen.getByText("4 – 10 °C")).toBeVisible();
  await expect.element(screen.getByText("12:00")).toBeVisible();
  expect(ruleAt()).toBeNull();
});

test("a finger held on a chart reads it and follows; a finger passing by scrolls", async () => {
  const { screen } = await show({ forecasts: DRY });

  await expect.element(screen.getByText("4 – 10 °C")).toBeVisible();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  // A scroll starts on the chart: nothing is read.
  finger("pointerdown", 14);
  finger("pointermove", 14, 30);
  vi.advanceTimersByTime(1000);
  finger("pointercancel", 14, 30);
  await tick();
  expect(ruleAt()).toBeNull();

  finger("pointerdown", 14);
  await tick();
  expect(ruleAt()).toBeNull();

  vi.advanceTimersByTime(1000);
  await tick();
  expect(ruleAt()).toBeCloseTo((14.5 / 24) * 100, 1);

  finger("pointermove", 6);
  await tick();
  expect(ruleAt()).toBeCloseTo((6.5 / 24) * 100, 1);

  finger("pointerup", 6);
  await tick();
  expect(ruleAt()).toBeNull();
});
