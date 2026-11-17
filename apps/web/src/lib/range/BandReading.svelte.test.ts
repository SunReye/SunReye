import { tick } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import type { Band } from "./bands.ts";
import BandChart from "./BandChart.svelte";

afterEach(() => {
  vi.useRealTimers();
});

const band = (key: string, up: number): Band => ({
  key,
  label: key,
  tick: true,
  title: `Band ${key}`,
  state: "data",
  partial: false,
  up: [up],
  down: [],
  drillable: true,
});

/** Two bands, each opened through `ondrill`. */
async function mount(ondrill: (i: number) => void = () => {}) {
  const screen = await render(BandChart, {
    bands: [band("b0", 2), band("b1", 4)],
    up: [{ label: "PV", colour: "var(--e-solar)" }],
    summary: { title: "Summe", up: [6], down: [] },
    fmt: (v: number) => `${v.toFixed(1)} kWh`,
    unit: "kWh",
    label: "Produktion",
    ondrill,
  });

  await expect.element(screen.getByText("Summe")).toBeVisible();

  return screen;
}

/** A finger's event at `share` of the plot's width, `dy` px below its middle. */
function finger(type: string, share: number, dy = 0): void {
  const plot = document.querySelector<HTMLElement>("[data-scrub]")!;
  const box = plot.getBoundingClientRect();

  plot.dispatchEvent(
    new PointerEvent(type, {
      clientX: box.left + box.width * share,
      clientY: box.top + box.height / 2 + dy,
      pointerType: "touch",
      pointerId: 7,
      buttons: 1,
      bubbles: true,
    }),
  );
}

test("on touch, a finger passing by scrolls: nothing is read", async () => {
  const screen = await mount();

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  finger("pointerdown", 0.75);
  finger("pointermove", 0.75, 30);
  vi.advanceTimersByTime(1000);
  finger("pointercancel", 0.75, 30);
  await tick();

  expect(screen.getByText("Band b1").query()).toBeNull();
});

test("on touch, a finger held on a band reads it and follows; lifted, the sum returns", async () => {
  const drilled: number[] = [];

  const screen = await mount((i) => {
    drilled.push(i);
  });

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  finger("pointerdown", 0.75);
  await tick();
  expect(screen.getByText("Band b1").query()).toBeNull();

  vi.advanceTimersByTime(1000);
  await tick();
  expect(screen.getByText("Band b1").query()).not.toBeNull();

  finger("pointermove", 0.25);
  await tick();
  expect(screen.getByText("Band b0").query()).not.toBeNull();

  finger("pointerup", 0.25);
  await tick();
  expect(screen.getByText("Band b0").query()).toBeNull();
  expect(screen.getByText("Summe").query()).not.toBeNull();
  // A held finger reads; only a tap opens.
  expect(drilled).toEqual([]);
});
