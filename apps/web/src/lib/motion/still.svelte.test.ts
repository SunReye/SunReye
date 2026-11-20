// Motion values come from the motion tokens (ADR 21): on the still tier every one is 0.
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import SceneStandIn from "../dashboard/SceneStandIn.svelte";
import LiveArea from "../live-graph/LiveArea.svelte";
import Pager from "../range/pager.harness.svelte";
import Boot from "../shell/Boot.svelte";
import Rail from "../shell/rail.harness.svelte";
import { EXIT_MS } from "./values.ts";

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

const SCREENS = [
  { name: "the boot line", mount: () => render(Boot), selector: "[role=status]" },
  {
    name: "the scene stand-in's line",
    mount: () => render(SceneStandIn, { slow: true }),
    selector: "[role=status]",
  },
  {
    name: "the rail's labels",
    mount: () => render(Rail),
    selector: ".rail .label",
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
  },
  { name: "a pager's crossfade", mount: () => render(Pager, { steps: [] }), selector: ".inner" },
] as const;

test.each(SCREENS)("$name moves on full", async ({ mount, selector }) => {
  await mount();

  await expect.poll(() => timings(selector).length).toBeGreaterThan(0);
  expect(Math.max(...timings(selector))).toBeGreaterThan(0);
});

test.each(SCREENS)("$name is instant on the still tier", async ({ mount, selector }) => {
  document.documentElement.dataset["motion"] = "still";
  await mount();

  await expect.poll(() => timings(selector).length).toBeGreaterThan(0);
  expect(timings(selector).every((s) => s === 0)).toBe(true);
});

test("a timer that waits an exit out waits as long as the exit token", () => {
  expect(getComputedStyle(document.documentElement).getPropertyValue("--motion-exit")).toBe(
    `${EXIT_MS}ms`,
  );
});
