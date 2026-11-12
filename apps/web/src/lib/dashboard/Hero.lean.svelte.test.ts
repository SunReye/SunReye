// Its own file: no other test may load three.js into this page first.
import "../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import type { SceneLayout } from "../live/dashboard.ts";
import { motion } from "../motion/tier.svelte.ts";
import Hero from "./Hero.svelte";

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
});

afterEach(() => {
  motion.lowPower = false;
});

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
  // Long enough for an idle load to have started.
  await new Promise((resolve) => {
    setTimeout(resolve, 2000);
  });

  expect(asked).not.toContain("/api/v1/module-types");
  expect(threeLoaded()).toBe(false);
  expect(page.getByText("3D-Ansicht lädt …").elements()).toHaveLength(0);
});
