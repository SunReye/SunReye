import "../../app.css";
import { afterEach, expect, test, vi } from "vitest";
import { tick } from "svelte";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import LiveArea from "./LiveArea.svelte";
import type { LivePoint } from "./series.ts";

afterEach(() => {
  // Lets every glide end on the injected clock: Svelte's frame loop would otherwise stay marked
  // as running on a frame that never comes, and the next test's glide would never start.
  vi.advanceTimersByTime(6000);
  vi.useRealTimers();
});

const T0 = 1_700_000_000_000;

/** One sample a second for a minute, ending at `end`, wobbling around `level` watts. */
function feed(end: number, level = 2000): LivePoint[] {
  return Array.from({ length: 60 }, (_, i) => ({
    t: end - (59 - i) * 1000,
    v: level + (i % 5) * 100,
  }));
}

const IMPORT = "rgb(200, 0, 0)";
const EXPORT = "rgb(0, 0, 200)";

/** The graph on an injected frame clock. */
async function mount(props: Partial<{ still: boolean; stalled: boolean; diverging: boolean }>) {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });

  const screen = await render(LiveArea, {
    points: feed(T0),
    accent: IMPORT,
    below: EXPORT,
    still: false,
    stalled: false,
    diverging: false,
    ...props,
  });

  // The marks' group is the one whose transform only ever moves along x.
  const marks = () =>
    [...screen.container.querySelectorAll("g[transform]:has(path)")].find((g) =>
      /^translate\([-\d.e]+,0\)$/u.test(g.getAttribute("transform") ?? ""),
    );

  await expect.poll(marks).toBeDefined();

  return {
    screen,
    transform: () => marks()?.getAttribute("transform"),
    paths: () => [...(marks()?.querySelectorAll("path[d]") ?? [])].map((p) => p.getAttribute("d")),
    ticks: () => screen.container.querySelector(".lc-axis")?.textContent ?? "",
  };
}

/** Steps the injected clock frame by frame, letting Svelte flush after each. */
async function frames(ms: number) {
  for (let t = 0; t < ms; t += 16) {
    vi.advanceTimersByTime(16);
    // oxlint-disable-next-line no-await-in-loop -- each frame flushes before the next one runs.
    await tick();
  }
}

test("between samples only the marks' transform moves: no data or scale update", async () => {
  const graph = await mount({});
  const paths = graph.paths();
  const ticks = graph.ticks();
  const seen = new Set<string | null | undefined>();

  await graph.screen.rerender({ points: [...feed(T0), { t: T0 + 1000, v: 2300 }] });

  const settled = graph.paths();

  for (let i = 0; i < 40; i++) {
    // oxlint-disable-next-line no-await-in-loop -- one frame at a time, read between frames.
    await frames(16);
    seen.add(graph.transform());
    expect(graph.paths()).toEqual(settled);
  }

  expect(settled).not.toEqual(paths);
  expect(graph.ticks()).toBe(ticks);
  expect(seen.size).toBeGreaterThan(1);
});

test("the marks scroll left as the cursor glides toward the newest sample", async () => {
  const graph = await mount({});

  await graph.screen.rerender({ points: [...feed(T0), { t: T0 + 1000, v: 2300 }] });
  await frames(32);
  const early = Number(/translate\(([-\d.]+),/u.exec(graph.transform() ?? "")?.[1]);
  await frames(600);
  const later = Number(/translate\(([-\d.]+),/u.exec(graph.transform() ?? "")?.[1]);

  expect(later).toBeLessThan(early);
});

test("still motion steps per sample without gliding", async () => {
  const graph = await mount({ still: true });
  const paths = graph.paths();

  await graph.screen.rerender({ points: [...feed(T0), { t: T0 + 1000, v: 2300 }] });
  await frames(600);

  expect(graph.paths()).not.toEqual(paths);
  expect(graph.transform()).toBe("translate(0,0)");
});

test("a stalled stream parks the marks and dims the plot", async () => {
  const graph = await mount({ stalled: true });

  await frames(600);

  expect(graph.transform()).toBe("translate(0,0)");
  expect(graph.screen.container.querySelector(".opacity-50")).not.toBeNull();
});

test("a diverging fill splits at zero: import above, export below", async () => {
  const graph = await mount({ diverging: true });

  await graph.screen.rerender({
    points: feed(T0).map((p, i) => ({ t: p.t, v: i % 2 === 0 ? 1500 : -1500 })),
  });

  const stops = [...graph.screen.container.querySelectorAll("linearGradient[id$='-fill'] stop")];
  const colours = stops.map((s) => getComputedStyle(s).stopColor);
  const offsets = new Set(stops.slice(1, 3).map((s) => Number(s.getAttribute("offset"))));

  expect(colours).toContain(IMPORT);
  expect(colours).toContain(EXPORT);
  expect(colours.indexOf(IMPORT)).toBeLessThan(colours.indexOf(EXPORT));
  expect(offsets.size).toBe(1);
  expect([...offsets][0]).toBeCloseTo(0.5, 1);
});

test("pointing at the plot floats no tooltip: the legend is the readout (ADR 21)", async () => {
  const graph = await mount({});
  const plot = graph.screen.container.querySelector<HTMLElement>(".lc-tooltip-context")!;

  await userEvent.hover(plot);
  await frames(64);

  expect(document.querySelector(".lc-tooltip-root")).toBeNull();
});
