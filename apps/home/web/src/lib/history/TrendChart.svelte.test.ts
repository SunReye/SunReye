import { tick } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { sheetContext } from "../detail/in-sheet.ts";
import TrendChart from "./TrendChart.svelte";

// A trend reads on the one pointer reading (ADR 21 "Chart reading"): the day under the pointer in
// the legend, a rule at it, and inside a sheet a finger only once held.

afterEach(() => {
  vi.useRealTimers();
});

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1);

/** Five days, 1 to 5 November, each its day of the month as its value. */
async function mount(sheet = false) {
  const screen = await render(TrendChart, {
    props: {
      rows: Array.from({ length: 5 }, (_, i) => ({
        x: new Date(T0 + i * DAY),
        values: { soh: i + 1 },
      })),
      series: [{ key: "soh", label: "SoH", colour: "red", kind: "line" as const }],
      fmt: (v: number) => `${v} %`,
      label: "Trend",
    },
    context: sheet ? sheetContext() : new Map(),
  });

  await expect.poll(() => document.querySelector("[data-plot]")).not.toBeNull();

  return { legend: screen.getByRole("list") };
}

const plot = () => document.querySelector<HTMLElement>("[data-plot]")!;

/** Where day `i` stands on the plot, in its own box: the first at its left edge. */
function at(i: number) {
  const box = plot().getBoundingClientRect();

  return { x: (box.width * i) / 4, y: box.height / 2 };
}

const rule = () => document.querySelector<HTMLElement>("[data-read]");

test("the pointer reads the day under it in the legend, with a rule; leaving clears it", async () => {
  const { legend } = await mount();

  await userEvent.hover(plot(), { position: at(3) });
  await expect.element(legend.getByText("4 %")).toBeVisible();
  await expect.element(legend.getByText("4. Nov. 2026")).toBeVisible();
  expect(rule()?.style.left).toBe("75%");

  await userEvent.unhover(plot());
  await expect.poll(rule).toBeNull();
  expect(legend.getByText("4 %").query()).toBeNull();
});

test("in a sheet a finger reads a trend once held", async () => {
  const { legend } = await mount(true);
  const box = plot().getBoundingClientRect();

  const finger = (type: string) => {
    plot().dispatchEvent(
      new PointerEvent(type, {
        pointerType: "touch",
        pointerId: 7,
        clientX: box.left + at(1).x,
        clientY: box.top + at(1).y,
        buttons: 1,
        bubbles: true,
      }),
    );
  };

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  finger("pointerdown");
  await tick();
  expect(legend.getByText("2 %").query()).toBeNull();

  vi.advanceTimersByTime(300);
  await tick();
  expect(legend.getByText("2 %").query()).not.toBeNull();

  finger("pointerup");
  await tick();
  expect(legend.getByText("2 %").query()).toBeNull();
});
