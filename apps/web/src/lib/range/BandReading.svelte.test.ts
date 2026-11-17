import { tick } from "svelte";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import type { Band } from "./bands.ts";
import BandChart from "./BandChart.svelte";

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

// No sheet around it: a full screen, where a finger reads at once (ADR 21 "Sheet content").

test("on a full screen, a finger that scrolls leaves nothing read", async () => {
  const screen = await mount();

  finger("pointerdown", 0.75);
  finger("pointermove", 0.75, 30);
  finger("pointercancel", 0.75, 30);
  await tick();

  expect(screen.getByText("Band b1").query()).toBeNull();
});

test("on a full screen, a finger reads at once and follows; lifted, its band stays to open", async () => {
  const drilled: number[] = [];

  const screen = await mount((i) => {
    drilled.push(i);
  });

  finger("pointerdown", 0.75);
  await tick();
  expect(screen.getByText("Band b1").query()).not.toBeNull();

  finger("pointermove", 0.25);
  await tick();
  expect(screen.getByText("Band b0").query()).not.toBeNull();

  finger("pointerup", 0.25);
  await tick();
  // A finger that moved reads; only a tap opens, and the legend offers the band it left.
  expect(drilled).toEqual([]);
  expect(screen.getByText("Band b0").query()).not.toBeNull();

  await screen.getByRole("button", { name: "Öffnen" }).click();
  expect(drilled).toEqual([0]);
});

test("on a full screen, a tap opens its band", async () => {
  const drilled: number[] = [];

  await mount((i) => {
    drilled.push(i);
  });

  finger("pointerdown", 0.75);
  finger("pointerup", 0.75);
  await tick();

  expect(drilled).toEqual([1]);
});
