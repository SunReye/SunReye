// The builder takes an aerial image and neighbours from whoever embeds it (ADR 20, 25): it draws
// both, and loads nothing itself.
import "../../app.css";
import { Object3D } from "three";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { Studio } from "../../../../../packages/builder/src/scene/studio.ts";
import Builder from "../../../../../packages/builder/src/builder/Builder.svelte";
import {
  desk,
  DEVICES,
  hosted,
  house,
  MODULE,
  pv,
  settle,
  testCore,
  undesk,
} from "./builder.harness.ts";
import type { Aerial, Neighbour } from "../../../../../packages/builder/src/builder/pv.ts";

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
});

/** A field south of the house, 40 m a side round it, painted by the test: nothing is loaded. */
function aerial(): Aerial {
  const image = document.createElement("canvas");

  image.width = 16;
  image.height = 16;

  const pen = image.getContext("2d");

  if (pen !== null) {
    pen.fillStyle = "#4a7a3a";
    pen.fillRect(0, 0, 16, 16);
  }

  return { image, extent: { west: -15, south: -28, east: 25, north: 12 } };
}

/** A neighbour's house east of the plant. */
const NEIGHBOUR: Neighbour = {
  footprint: [
    [16, -2],
    [24, -2],
    [24, -10],
    [16, -10],
  ],
  height: 7,
};

/** Every name drawn so far, by the passes `renders` saw draw. */
function drawnNames(renders: {
  readonly mock: { readonly contexts: readonly unknown[] };
}): Set<string> {
  const names = new Set<string>();

  for (const pass of renders.mock.contexts) {
    if (pass instanceof RenderPass && pass.scene instanceof Object3D) {
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
      pass.scene.traverse((part) => names.add(part.name));
    }
  }

  return names;
}

test("the consumer's image and neighbours are drawn, and the builder loads nothing", async () => {
  const fetched = vi.spyOn(globalThis, "fetch");
  const renders = vi.spyOn(RenderPass.prototype, "render");

  await render(Builder, {
    pv,
    ...hosted(testCore()),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
    aerial: aerial(),
    neighbours: [NEIGHBOUR],
  });

  await settle(() => drawnNames(renders).has("aerial") && drawnNames(renders).has("neighbour"));

  expect(fetched).not.toHaveBeenCalled();
});

test("without them the builder draws neither", async () => {
  const renders = vi.spyOn(RenderPass.prototype, "render");

  await render(Builder, {
    pv,
    ...hosted(testCore()),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await settle(() => drawnNames(renders).has("roof"));

  expect(drawnNames(renders).has("aerial")).toBe(false);
  expect(drawnNames(renders).has("neighbour")).toBe(false);
});

test("the image does not widen the plot the sun's shadow and the floor are fitted to", async () => {
  const framed = vi.spyOn(Studio.prototype, "frame");

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the image is the DOM's own.
  const radius = async (given?: Aerial): Promise<number> => {
    framed.mockClear();

    const screen = await render(Builder, {
      pv,
      ...hosted(testCore()),
      start: house(),
      moduleTypes: [MODULE],
      devices: DEVICES,
      aerial: given,
    });

    await settle(() => framed.mock.calls.length > 0);
    await screen.unmount();

    return framed.mock.lastCall?.[1] ?? 0;
  };

  const alone = await radius();

  expect(await radius(aerial())).toBeCloseTo(alone, 6);
});
