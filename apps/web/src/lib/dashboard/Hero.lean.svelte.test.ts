// Its own file: no other test may load three.js into this page first.
import "../../app.css";
import { tick } from "svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import type { SceneLayout } from "../live/dashboard.ts";
import { motion } from "@sunreye/builder/motion/tier.svelte.ts";
import { warm } from "@sunreye/builder/scene/warm.ts";
import Hero from "./Hero.svelte";
import { realTimers } from "../motion/clock.harness.ts";

const layout: SceneLayout = {
  appliesFrom: "2026-11-01T00:00:00Z",
  scene: { north: 0, blocks: [], obstacles: [], grids: [] },
  strings: [],
  warnings: [],
};

/** What the hero asked the core for, by path. */
const asked: string[] = [];

const transport: Transport = {
  base: "http://core.test/",
  fetch: (request) => {
    asked.push(new URL(request.url).pathname);

    return Promise.withResolvers<Response>().promise;
  },
};

const threeLoaded = () =>
  performance
    .getEntriesByType("resource")
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's entry.
    .map((entry) => entry.name)
    .some((name) => /\/three[./]/u.test(name));

beforeEach(() => {
  asked.length = 0;
  localStorage.clear();
  // The main thread is idle at once: a load's idle task runs a frame after it starts.
  vi.stubGlobal("requestIdleCallback", (task: IdleRequestCallback) => {
    task({ didTimeout: false, timeRemaining: () => 50 });

    return 1;
  });
});

afterEach(() => {
  realTimers();
  vi.unstubAllGlobals();
  motion.lowPower = false;
});

/** One frame on the test's clock, its updates drawn. */
async function frame(): Promise<void> {
  vi.advanceTimersToNextFrame();
  await tick();
}

test.each([
  [
    "2D chosen",
    () => {
      localStorage.setItem("sunreye.dashboard", "2d");
    },
  ],
  [
    "the low-power switch",
    () => {
      motion.lowPower = true;
    },
  ],
  [
    "no WebGL2",
    () => {
      localStorage.setItem("sunreye.webgl2", "no");
    },
  ],
])("with %s the scene is never requested and the flow shows", async (_, given) => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  given();

  const screen = await render(Hero, {
    core: connect(transport),
    layout,
    admin: true,
    live: undefined,
    plant: undefined,
    plantStale: undefined,
    onselect: () => {},
    class: "h-[600px] w-[800px]",
  });

  await expect
    .element(screen.getByRole("button", { name: "Wechselrichter: Details" }))
    .toBeVisible();
  // A load's idle task has run by the second frame; it mounts the scene once the warm-up worker
  // answers, and a mounted scene shows in the frame after.
  await frame();
  await frame();
  await warm().webgl2;
  await frame();

  expect(page.getByRole("figure", { name: "Live-Ansicht des Hauses" }).elements()).toHaveLength(0);
  expect(asked).not.toContain("/api/v1/module-types");
  expect(threeLoaded()).toBe(false);
  expect(page.getByText("3D-Ansicht lädt …").elements()).toHaveLength(0);
});
