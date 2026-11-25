import { afterEach, expect, test } from "vitest";
import { Color, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Vector3 } from "three";
import { daylight, theme } from "../../../../../packages/builder/src/scene/light.ts";
import { look } from "./probe.harness.ts";
import { apart, mean, picture, post, SIDE } from "./studio-pixels.harness.ts";
import { Studio } from "../../../../../packages/builder/src/scene/studio.ts";
import { DRY } from "../../../../../packages/builder/src/scene/weather.ts";

let studio: Studio | undefined;

afterEach(() => {
  studio?.dispose();
  studio = undefined;
});

test("fog softens ambient occlusion and hides it entirely at the fog limit", () => {
  const opened = post("medium");

  studio = opened;
  const page = new Color(0.95, 0.95, 0.96);
  const sun = daylight([1, 0, 0.5]);
  opened.frame(new Vector3(-5, 0, 0), 5);

  const draw = (fog: number, occlusion: boolean): number[] => {
    opened.follow({ ...look("medium"), occlusion });
    opened.light(sun, theme(false), page, { ...DRY, fog });
    opened.render();

    return picture(opened);
  };

  const clear = apart(draw(0, true), draw(0, false));
  const veiled = apart(draw(1, true), draw(1, false));

  expect(clear).toBeGreaterThan(1.5);
  expect(veiled).toBeGreaterThan(0.2);
  expect(veiled).toBeLessThan(clear / 2);

  // Lift the camera past the fog's 51 m limit and keep the floor's framing.
  const { camera } = opened;

  if (!(camera instanceof PerspectiveCamera))
    throw new TypeError("the studio's camera is a perspective one");

  camera.position.y = 60;
  camera.fov = (360 * Math.atan(Math.tan(Math.PI / 9) / 2)) / Math.PI;
  camera.updateProjectionMatrix();
  expect(apart(draw(1, true), draw(1, false))).toBeLessThan(0.2);
});

/** Three rows of identical stripes on screen, at the same depth or spaced by `separation`. */
function stripes(separation: number): Studio {
  const camera = new PerspectiveCamera(40, 1, 0.1, 500);

  camera.position.set(0, 10, 20);
  camera.lookAt(0, 10, 0);
  studio = new Studio(document.createElement("canvas"), camera, () => look("low"));
  studio.setSize(SIDE, SIDE);
  studio.frame(new Vector3(0, 10, 0), 10);
  studio.scene.background = new Color(0x000000);

  const white = new MeshBasicMaterial({ fog: false });
  const black = new MeshBasicMaterial({ color: 0x000000, fog: false });

  for (const row of [-1, 0, 1]) {
    const metres = 20 + row * separation;
    const stripe = new PlaneGeometry(0.012 * metres, 0.07 * metres);
    const backing = new Mesh(new PlaneGeometry(0.38 * metres, 0.16 * metres), black);

    backing.position.set(0, 10 + row * 0.25 * metres, 20 - metres - 0.01);
    studio.scene.add(backing);

    for (let column = -4; column <= 4; column++) {
      const bar = new Mesh(stripe, white);

      bar.position.set(column * 0.025 * metres, 10 + row * 0.25 * metres, 20 - metres);
      studio.scene.add(bar);
    }
  }

  studio.render();

  return studio;
}

/** How much the pixels inside a row of stripes changed. */
function bandChange(before: readonly number[], after: readonly number[], row: number): number {
  const middle = Math.round(SIDE / 2 + (row * SIDE * 0.125) / Math.tan(Math.PI / 9));

  return mean(
    Array.from({ length: 16 * 112 }, (_, i) => {
      const pixel = (middle - 8 + Math.floor(i / 112)) * SIDE + SIDE / 2 - 56 + (i % 112);

      return Math.abs((before[pixel] ?? 0) - (after[pixel] ?? 0));
    }),
  );
}

test("tilt-shift blurs above and below the focus band even at the same depth", () => {
  const opened = stripes(0);
  const before = picture(opened);

  opened.focus({ tiltShift: true, depthOfField: false });
  opened.render();

  const shifted = picture(opened);

  expect(bandChange(before, shifted, 0)).toBe(0);
  expect(bandChange(before, shifted, -1)).toBeGreaterThan(3);
  expect(bandChange(before, shifted, 1)).toBeGreaterThan(3);
});

test("depth of field blurs near and far surfaces but leaves the plant's depth sharp", () => {
  const opened = stripes(10);
  const before = picture(opened);

  opened.focus({ tiltShift: false, depthOfField: true });
  opened.render();

  const focused = picture(opened);

  expect(bandChange(before, focused, 0)).toBe(0);
  expect(bandChange(before, focused, -1)).toBeGreaterThan(3);
  expect(bandChange(before, focused, 1)).toBeGreaterThan(3);

  opened.focus({ tiltShift: false, depthOfField: false });
  opened.render();
  expect(picture(opened)).toEqual(before);
});

test("an out-of-focus point forms a filled bokeh disc instead of separate bright copies", () => {
  const camera = new PerspectiveCamera(40, 1, 0.1, 500);

  camera.position.set(0, 0, 20);
  camera.lookAt(0, 0, 0);
  studio = new Studio(document.createElement("canvas"), camera, () => look("low"));
  studio.setSize(SIDE, SIDE);
  studio.frame(new Vector3(), 10);
  const floor = studio.scene.getObjectByName("floor");

  if (floor === undefined) throw new TypeError("no floor");

  floor.visible = false;

  const backdrop = new Mesh(
    new PlaneGeometry(100, 100),
    new MeshBasicMaterial({ color: 0x000000, fog: false }),
  );

  const point = new Mesh(
    new PlaneGeometry(0.17, 0.17),
    new MeshBasicMaterial({ color: new Color(8, 8, 8), fog: false }),
  );

  backdrop.position.z = -20.01;
  point.position.z = -20;
  studio.scene.add(backdrop, point);
  studio.focus({ tiltShift: false, depthOfField: true });
  studio.render();

  const pixels = picture(studio);

  const bands = pixels.filter((_, i) => {
    const radius = Math.hypot((i % SIDE) + 0.5 - SIDE / 2, Math.floor(i / SIDE) + 0.5 - SIDE / 2);

    return radius > 2 && radius < 8;
  });

  expect(bands.filter((value) => value > 3).length / bands.length).toBeGreaterThan(0.9);
});
