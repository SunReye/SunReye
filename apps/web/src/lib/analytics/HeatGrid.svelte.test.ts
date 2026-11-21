import { tick } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { sheetContext } from "../detail/in-sheet.ts";
import HeatGrid from "./HeatGrid.svelte";

// The heat grid reads on the one pointer reading (ADR 21 "Chart reading"): a finger on a full
// screen reads at once and a tap drills; inside a sheet it reads once held.

afterEach(() => {
  vi.useRealTimers();
});

/** Four days of hours, each cell its hour; `drilled` is told the days opened. */
async function mount(sheet = false) {
  const drilled: number[] = [];

  const screen = await render(HeatGrid, {
    props: {
      cols: Array.from({ length: 4 }, (_, i) => ({ label: `${i}`, tick: true, title: `Tag ${i}` })),
      cells: Array.from({ length: 4 }, () => Array.from({ length: 24 }, (_, h) => h)),
      colour: () => "red",
      describe: (v: number | null) => `${v} kWh`,
      idle: "Muster",
      label: "Muster",
      ondrill: (col: number) => {
        drilled.push(col);
      },
    },
    context: sheet ? sheetContext() : new Map(),
  });

  await expect.element(screen.getByText("Muster", { exact: true })).toBeVisible();

  return { screen, drilled };
}

/** A finger's event over day `col`'s hour `hour`. */
function finger(type: string, col: number, hour: number): void {
  const grid = document.querySelector<HTMLElement>("[data-scrub]")!;
  const box = grid.getBoundingClientRect();

  grid.dispatchEvent(
    new PointerEvent(type, {
      pointerType: "touch",
      pointerId: 7,
      clientX: box.left + ((col + 0.5) / 4) * box.width,
      clientY: box.top + ((hour + 0.5) / 24) * box.height,
      buttons: 1,
      bubbles: true,
    }),
  );
}

test("on a full screen a finger reads a cell at once, and a tap drills its day", async () => {
  const { screen, drilled } = await mount();

  finger("pointerdown", 2, 10);
  await tick();
  expect(screen.getByText("Tag 2 · 10:00–11:00 Uhr").query()).not.toBeNull();

  finger("pointerup", 2, 10);
  expect(drilled).toEqual([2]);
});

test("in a sheet a finger reads a cell once held, lifted it rests, and a quick tap drills", async () => {
  const { screen, drilled } = await mount(true);

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  finger("pointerdown", 1, 6);
  await tick();
  expect(screen.getByText(/^Tag 1/u).query()).toBeNull();

  vi.advanceTimersByTime(300);
  await tick();
  expect(screen.getByText("Tag 1 · 6:00–7:00 Uhr").query()).not.toBeNull();

  finger("pointerup", 1, 6);
  await tick();
  expect(screen.getByText(/^Tag 1/u).query()).toBeNull();
  expect(drilled).toEqual([]);

  finger("pointerdown", 3, 6);
  finger("pointerup", 3, 6);
  expect(drilled).toEqual([3]);
});
