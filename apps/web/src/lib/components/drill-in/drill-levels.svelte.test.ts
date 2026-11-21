// The drill-in's levels on a phone: no surface resizes as they trade places, and each keeps its
// own scroll position (ADR 21).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Harness from "./drill-in.harness.svelte";
import { child, frame, offset, rect, scrolled, until } from "./drill-in.probe.ts";
import { realTimers } from "../../motion/clock.harness.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
});

afterEach(async () => {
  realTimers();
  await page.viewport(414, 896);
});

/** Runs `sample` on every frame until the returned stop is called. */
function everyFrame(sample: () => void): () => void {
  let on = true;

  const tick = () => {
    if (!on) return;

    sample();
    requestAnimationFrame(tick);
  };

  tick();

  return () => {
    on = false;
  };
}

/** Every value `read` gives, frame by frame, until `stop`; a frame without one is left out. */
function watch(read: () => number | undefined) {
  const seen = new Set<number>();

  const stop = everyFrame(() => {
    const value = read();

    if (value !== undefined) seen.add(Math.round(value));
  });

  return { seen, stop };
}

/** The top of the element `find` gives, while it is drawn. */
const topOf = (find: () => Element | null) => () => {
  const box = find()?.getBoundingClientRect();

  return box === undefined || box.height === 0 ? undefined : box.top;
};

const header = () => document.querySelector("[data-drill=header]");

test("no surface changes height across a drill in and out", async () => {
  await page.viewport(390, 844);
  const screen = await render(Harness, { width: 390 });
  const first = new Map<Element, number>();
  const resized: string[] = [];

  // Every glass surface drawn, each frame of both slides.
  const stop = everyFrame(() => {
    for (const surface of document.querySelectorAll(".glass-ambient, .drill-card")) {
      const height = Math.round(surface.getBoundingClientRect().height);
      const before = first.get(surface) ?? height;

      if (height > 0) first.set(surface, before);

      if (height > 0 && height !== before) resized.push(`${before} → ${height}`);
    }
  });

  await screen.getByRole("button", { name: /Batterie/u }).click();
  await until(() => offset() === 0);
  await frame();
  await frame();
  history.back();
  await until(() => child() === null);
  await frame();
  await frame();
  stop();

  expect(resized).toEqual([]);
  // The root's card, and the level's header and card.
  expect(first.size).toBeGreaterThanOrEqual(3);
});

test("a level opens at its top and back returns the root to where it was", async () => {
  await page.viewport(390, 600);
  const screen = await render(Harness, { width: 390, tall: true });
  const row = screen.getByRole("button", { name: /Gruppe 9/u });
  const rowTop = topOf(() => row.elements()[0] ?? null);

  await scrolled(300);

  const resting = Math.round(rect(row.element()).top);
  const opening = watch(rowTop);

  await row.click();
  await until(() => offset() === 0);
  opening.stop();

  expect(scrollY).toBe(0);
  // The root stayed where it was while the level came in over it.
  expect([...opening.seen]).toEqual([resting]);

  // A scroll the page has seen, as a finger's is before it reaches back.
  await scrolled(150);

  const stuck = Math.round(rect(header()).top);
  const leaving = watch(topOf(header));
  const returning = watch(rowTop);

  history.back();
  await until(() => child() === null);
  await frame();
  leaving.stop();
  returning.stop();

  expect(scrollY).toBe(300);
  // The root came back where it lands, and the level's header left from the top of the screen.
  expect([...returning.seen]).toEqual([resting]);
  expect([...leaving.seen]).toEqual([stuck]);
});
