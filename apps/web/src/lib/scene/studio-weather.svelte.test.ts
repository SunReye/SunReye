import { afterEach, expect, test } from "vitest";
import { Color, Fog, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from "three";
import { daylight, theme } from "./light.ts";
import { drawn } from "./quality.ts";
import { Studio } from "./studio.ts";
import { DRY } from "./weather.ts";

let studio: Studio | undefined;

function open(): Studio {
  const canvas = document.createElement("canvas");

  document.body.append(canvas);
  studio = new Studio(canvas, new PerspectiveCamera(40, 1, 0.1, 5000), () =>
    drawn("medium", { capable: false, steps: 0, tier: "full" }),
  );
  studio.setSize(64, 64);

  return studio;
}

afterEach(() => {
  studio?.dispose();
  studio = undefined;
});

test("the weather's fog closes in round the plot and greys; clear again, it is the page's", () => {
  const opened = open();
  const noon = daylight([0, -0.5, 0.866]);
  const page = new Color(0.95, 0.95, 0.96);
  const { fog } = opened.scene;

  if (!(fog instanceof Fog)) throw new TypeError("no fog");

  opened.frame(new Vector3(), 10);
  opened.light(noon, theme(false), page);

  const clear = { near: fog.near, far: fog.far, colour: fog.color.getHex() };
  const backdrop = opened.scene.background;

  opened.light(noon, theme(false), page, { ...DRY, fog: 1 });
  expect([fog.near, fog.far].map((metres) => Math.round(metres * 10) / 10)).toEqual([2, 51.1]);
  expect(fog.color.g).toBeLessThan(0.6 * new Color(clear.colour).g);
  // The backdrop is made anew, in the fog's grey: far things melt into it.
  expect(opened.scene.background).not.toBe(backdrop);

  opened.light(noon, theme(false), page, DRY);
  expect({ near: fog.near, far: fog.far, colour: fog.color.getHex() }).toEqual(clear);
});

test("the studio floor is wet and snowed on with the weather", () => {
  const opened = open();
  const noon = daylight([0, -0.5, 0.866]);
  const page = new Color(0.95, 0.95, 0.96);
  const floor = opened.scene.getObjectByName("floor");

  if (!(floor instanceof Mesh) || !(floor.material instanceof MeshStandardMaterial))
    throw new TypeError("no floor");

  const { color } = floor.material;

  opened.light(noon, theme(false), page);

  const dry = color.g;

  opened.light(noon, theme(false), page, { ...DRY, wet: 1 });
  expect(color.g).toBeLessThan(0.8 * dry);
  opened.light(noon, theme(false), page, { ...DRY, snow: true });
  expect(color.g).toBeGreaterThan(1.2 * dry);
});
