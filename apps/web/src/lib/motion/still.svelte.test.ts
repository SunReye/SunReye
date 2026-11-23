// Motion values come from the motion tokens (ADR 21): on the still tier every one is 0.
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import SceneStandIn from "../dashboard/SceneStandIn.svelte";
import LiveArea from "../live-graph/LiveArea.svelte";
import type { Band } from "../range/bands.ts";
import BandChart from "../range/BandChart.svelte";
import Pager from "../range/pager.harness.svelte";
import Boot from "../shell/Boot.svelte";
import Rail from "../shell/rail.harness.svelte";
import { EXIT_MS } from "@sunreye/builder/motion/values.ts";

afterEach(() => {
  delete document.documentElement.dataset["motion"];
});

/** Every transition's duration and delay on `selector`'s elements, in s. */
function timings(selector: string): number[] {
  return [...document.querySelectorAll(selector)].flatMap((el) => {
    const style = getComputedStyle(el);

    return [style.transitionDuration, style.transitionDelay].flatMap((list) =>
      list.split(",").map((s) => Number(s.trim().replace("s", ""))),
    );
  });
}

const band = (key: string, up: number): Band => ({
  key,
  label: key,
  tick: true,
  title: key,
  state: "data",
  partial: false,
  up: [up],
  down: [],
  mark: up / 2,
  drillable: true,
});

/** A band chart of `n` bands, with a reference beside each. */
const bandChart = (n: number) => ({
  bands: Array.from({ length: n }, (_, i) => band(`b${i}`, i + 1)),
  up: [{ label: "PV", colour: "var(--e-solar)" }],
  markLabel: "Prognose",
  summary: { title: "Summe", up: [1], down: [] },
  fmt: (v: number) => `${v} kWh`,
  unit: "kWh",
  label: "Produktion",
});

const SCREENS = [
  { name: "the boot line", mount: () => render(Boot), selector: "[role=status]", full: 0.18 },
  {
    name: "the scene stand-in's line",
    mount: () => render(SceneStandIn, { slow: true }),
    selector: "[role=status]",
    full: 0.18,
  },
  {
    name: "the rail's labels",
    mount: () => render(Rail),
    selector: ".rail .label",
    // Folded: the exit's.
    full: 0.15,
  },
  {
    name: "a stalled live graph's dimming",
    mount: () =>
      render(LiveArea, {
        points: [],
        accent: "red",
        below: "blue",
        still: false,
        stalled: true,
        diverging: false,
      }),
    selector: "div.transition-opacity",
    full: 0.25,
  },
  {
    name: "the band chart's gridlines",
    mount: () => render(BandChart, bandChart(2)),
    selector: ".tick",
    full: 0.3,
  },
  {
    name: "the band chart's references",
    mount: () => render(BandChart, bandChart(2)),
    selector: ".mark",
    full: 0.3,
  },
  {
    name: "the band chart's axis labels",
    mount: () => render(BandChart, bandChart(2)),
    selector: ".label",
    full: 0.3,
  },
  {
    name: "the band chart's reference key",
    mount: () => render(BandChart, bandChart(2)),
    selector: ".key",
    full: 0.18,
  },
  {
    name: "the band being read",
    mount: () => render(BandChart, bandChart(2)),
    selector: ".hl",
    full: 0.12,
  },
  {
    name: "a pager's crossfade",
    mount: () => render(Pager, { steps: [] }),
    selector: ".inner",
    full: 0.25,
  },
] as const;

test.each(SCREENS)(
  "$name moves on full, for its token's time",
  async ({ mount, selector, full }) => {
    await mount();

    await expect.poll(() => timings(selector).length).toBeGreaterThan(0);
    expect(Math.max(...timings(selector))).toBe(full);
  },
);

test.each(SCREENS)("$name is instant on the still tier", async ({ mount, selector }) => {
  document.documentElement.dataset["motion"] = "still";
  await mount();

  await expect.poll(() => timings(selector).length).toBeGreaterThan(0);
  expect(timings(selector).every((s) => s === 0)).toBe(true);
});

test.each([
  { tier: "full", time: 0.15 },
  { tier: "still", time: 0 },
] as const)(
  "a band chart's leaving bar exits on the exit token on $tier",
  async ({ tier, time }) => {
    if (tier === "still") document.documentElement.dataset["motion"] = "still";

    const screen = await render(BandChart, bandChart(3));

    await expect.poll(() => document.querySelectorAll(".bar")).toHaveLength(3);
    await screen.rerender(bandChart(2));

    await expect.poll(() => document.querySelectorAll(".bar.out")).toHaveLength(1);

    const style = getComputedStyle(document.querySelector(".bar.out")!);

    expect(style.transitionDuration).toBe(`${time}s, ${time}s`);
    expect(style.transitionTimingFunction).toContain("cubic-bezier(0.55, 0.055, 0.675, 0.19)");
  },
);

test("a timer that waits an exit out waits as long as the exit token", () => {
  expect(getComputedStyle(document.documentElement).getPropertyValue("--motion-exit")).toBe(
    `${EXIT_MS}ms`,
  );
});
