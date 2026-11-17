import { tick } from "svelte";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import type { LivePoint } from "../live-graph/series.ts";
import LiveSection from "./LiveSection.svelte";

// Still motion: the marks stand on their samples, so the pointer's place names one exactly.
beforeAll(async () => {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await page.viewport(1280, 800);
});

afterAll(async () => {
  vi.useRealTimers();
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

const T0 = 1_700_000_000_000;

/** A sample a second for a minute up to T0, each 100 W above the one before: 0 W … 5,9 kW. */
const POINTS: LivePoint[] = Array.from({ length: 60 }, (_, i) => ({
  t: T0 - (59 - i) * 1000,
  v: i * 100,
}));

async function mount() {
  const screen = await render(LiveSection, {
    spec: { colour: "rgb(200, 0, 0)", node: "pv", chart: null },
    points: POINTS,
    silent: null,
    status: "live",
  });
  const live = screen.getByRole("region", { name: "Live-Leistung" });

  await expect.element(live.getByText("Live · letzte 2 Minuten")).toBeVisible();

  return { screen, live };
}

/** The plot's reading surface, right of the value axis. */
const plot = () => document.querySelector<HTMLElement>("[data-plot]")!;

/** A point `ago` seconds before the newest sample, in the plot's own box: it spans 2 minutes. */
function before(ago: number) {
  const box = plot().getBoundingClientRect();

  return { x: box.width * (1 - ago / 120), y: box.height / 2 };
}

function finger(type: string, ago: number): void {
  const box = plot().getBoundingClientRect();
  const { x, y } = before(ago);

  plot().dispatchEvent(
    new PointerEvent(type, {
      pointerType: "touch",
      pointerId: 7,
      clientX: box.left + x,
      clientY: box.top + y,
      buttons: 1,
      bubbles: true,
    }),
  );
}

const rule = () => plot().querySelector("[data-read]");

test("the pointer on the live graph reads the sample under it in the header; leaving restores it", async () => {
  const { live } = await mount();

  await userEvent.hover(plot(), { position: before(30) });

  // 30 s before the newest sample: the 29th, 2,9 kW.
  await expect.element(live.getByText("vor 30 s")).toBeVisible();
  await expect.element(live.getByText("2,9 kW")).toBeVisible();
  expect(rule()).not.toBeNull();
  expect(live.getByText("Live · letzte 2 Minuten").query()).toBeNull();
  expect(document.querySelector('[role="tooltip"], .lc-tooltip-root')).toBeNull();

  await userEvent.unhover(plot());

  await expect.element(live.getByText("Live · letzte 2 Minuten")).toBeVisible();
  expect(rule()).toBeNull();
});

test("a finger held on the live graph reads it; lifted, the graph rests", async () => {
  const { live } = await mount();

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  finger("pointerdown", 10);
  await tick();
  expect(rule()).toBeNull();

  vi.advanceTimersByTime(1000);
  await tick();
  await expect.element(live.getByText("4,9 kW")).toBeVisible();

  finger("pointerup", 10);
  await tick();
  expect(rule()).toBeNull();
  await expect.element(live.getByText("Live · letzte 2 Minuten")).toBeVisible();
  vi.useRealTimers();
});
