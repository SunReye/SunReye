import { afterEach, expect, test } from "vitest";
import { BoxGeometry, Color, Mesh, PerspectiveCamera, PlaneGeometry, Vector3 } from "three";
import type { Face, Point } from "../../../../../packages/builder/src/builder/pv.ts";
import { buildScene } from "../../../../../packages/builder/src/builder/scene.ts";
import { daylight, theme } from "../../../../../packages/builder/src/scene/light.ts";
import * as finish from "../../../../../packages/builder/src/scene/materials.ts";
import { look } from "./probe.harness.ts";
import type { Level } from "../../../../../packages/builder/src/scene/quality.ts";
import { Studio } from "../../../../../packages/builder/src/scene/studio.ts";
import { apart, mean, picture, post, SIDE } from "./studio-pixels.harness.ts";

let studio: Studio | undefined;

afterEach(() => {
  studio?.dispose();
  studio = undefined;
});

const shades = (some: readonly number[]): number => new Set(some).size;

/** How many pixels the shadow's edge takes to fade, across the shadow `metres` west of the post. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
function fade(opened: Studio, metres: number): number {
  const pixels = picture(opened);

  // The picture spans 2 × 30 m × tan 20° about x = -6; a column of it crosses the shadow.
  const column = Math.round(SIDE / 2 + ((6 - metres) / (60 * Math.tan(Math.PI / 9))) * SIDE);
  const light = Array.from({ length: SIDE }, (_, row) => pixels[row * SIDE + column] ?? 0);
  const [dark, lit] = [Math.min(...light), Math.max(...light)];

  // Half the pixels between dark and lit: the column crosses two edges.
  return (
    light.filter((v) => v > dark + (lit - dark) * 0.08 && v < lit - (lit - dark) * 0.08).length / 2
  );
}

test("Hoch's shadow is sharp where it touches its caster and widens with the distance", () => {
  const opened = post("high");

  studio = opened;
  const [near, far] = [fade(opened, 1.5), fade(opened, 10)];

  expect(near).toBeLessThanOrEqual(1);
  expect(far).toBeGreaterThanOrEqual(near + 1);
});

test("Mittel's shadow blurs alike along its length", () => {
  const opened = post("medium");

  studio = opened;

  expect(Math.abs(fade(opened, 10) - fade(opened, 1.5))).toBeLessThanOrEqual(1);
});

test("Ultra's burst smooths the edges of the picture it settles on, and changes nothing else", () => {
  const opened = post("ultra");

  studio = opened;
  const settled = picture(opened);

  while (opened.refine());

  const refined = picture(opened);

  // The same picture: no brighter, no darker, nothing moved.
  expect(Math.abs(mean(refined) - mean(settled))).toBeLessThan(0.5);
  // Finer steps along its slanted edges than four samples a pixel give.
  expect(shades(refined)).toBeGreaterThan(shades(settled) * 1.3);
});

/** A 4 m sheet of each finish side by side under a high sun, nothing casting on them, seen from
 * straight above. */
function sheets(level: Level): number[] {
  const camera = new PerspectiveCamera(40, 1, 0.1, 500);
  const makes = [finish.roofing, finish.floor, finish.GROUND.paving, () => finish.clay("#d8c8b0")];

  camera.position.set(0, 24, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  studio?.dispose();
  studio = new Studio(document.createElement("canvas"), camera, () => look(level));
  studio.setSize(SIDE, SIDE);

  for (const [i, make] of makes.entries()) {
    const sheet = new Mesh(new PlaneGeometry(4, 16), make());

    sheet.rotation.x = -Math.PI / 2;
    sheet.position.set(i * 4 - 6, 0.5, 0);
    sheet.receiveShadow = true;
    studio.scene.add(sheet);
  }

  studio.frame(new Vector3(), 10);
  studio.light(daylight([0.3, -0.4, 0.86]), theme(false), new Color(0.95, 0.95, 0.96));
  studio.render();

  return picture(studio);
}

test("Hoch and Ultra draw every finish in Mittel's colours: a level adds sharpness alone", () => {
  // One device pixel per CSS pixel, so the levels' pixel ratios draw the same grid.
  expect(window.devicePixelRatio).toBe(1);

  const medium = sheets("medium");
  const high = sheets("high");

  // What two studios at one level differ by: the occlusion's noise, coarser at Mittel (ADR 20).
  expect(apart(sheets("medium"), medium)).toBeLessThan(2);
  expect(apart(sheets("ultra"), high)).toBeLessThan(1);

  // A block of Mittel's is 1.3 of 255 off Hoch's, measured, and the whole no lighter or darker.
  expect(apart(high, medium)).toBeLessThan(2.5);
  expect(Math.abs(mean(high) - mean(medium))).toBeLessThan(0.25);

  // Niedrig, as a control: it draws without the occlusion that sets the sheets on the floor.
  expect(apart(sheets("low"), medium)).toBeGreaterThan(3);
});

/** A level roof 12 m square at 3 m as the scene builds it, filling the picture from above and
 * in front under a high sun, wound toward the camera or away from it; with `wall`, a wall stands
 * under its middle, up to the roof itself. */
function roofed(level: Level, toward: boolean, wall: boolean): number[] {
  // From afar through a long lens, as the dashboard sees a house: the depth buffer is coarse
  // there, and what lies in one plane fights over it.
  const camera = new PerspectiveCamera(8, 1, 0.1, 5000);

  const square: Point[] = [
    [-6, -6, 3],
    [6, -6, 3],
    [6, 6, 3],
    [-6, 6, 3],
  ];

  const under: Face = {
    surface: "wall",
    corners: [
      [-6, 0, 0],
      [6, 0, 0],
      [6, 0, 3],
      [-6, 0, 3],
    ],
  };

  camera.position.set(12, 48, 36);
  camera.lookAt(0, 3, 0);
  studio?.dispose();
  studio = new Studio(document.createElement("canvas"), camera, () => look(level));
  studio.setSize(SIDE, SIDE);
  studio.scene.add(
    buildScene({
      faces: [
        // Dark, so a pale wall showing through it tells.
        { surface: "roof", corners: toward ? square : square.toReversed(), colour: "#203040" },
        ...(wall ? [under] : []),
      ],
      solids: [],
    }),
  );
  studio.frame(new Vector3(), 10);
  studio.light(daylight([0.3, -0.4, 0.86]), theme(false), new Color(0.95, 0.95, 0.96));
  studio.render();

  return picture(studio);
}

test.each(["low", "medium", "high"] as const)(
  "at %s a wall behind a roof changes none of the roof's pixels, however the roof is wound",
  (level) => {
    for (const toward of [true, false]) {
      const bare = roofed(level, toward, false);

      expect([toward, apart(roofed(level, toward, true), bare) < 1]).toEqual([toward, true]);
    }
  },
);

test("a face wound away from the camera is lit as one wound toward it", () => {
  expect(apart(roofed("high", false, false), roofed("high", true, false))).toBeLessThan(1);
  expect(apart(roofed("medium", false, false), roofed("medium", true, false))).toBeLessThan(1);
});

test("white clay in full sun stays under white, and its shade lies well apart from it", () => {
  const camera = new PerspectiveCamera(40, 1, 0.1, 500);

  // From the north: the wall's shaded face, and the floor its shadow falls on.
  camera.position.set(0, 6, -12);
  camera.lookAt(0, 1, -2);
  camera.updateMatrixWorld();
  studio?.dispose();
  studio = new Studio(document.createElement("canvas"), camera, () => look("high"));
  studio.setSize(SIDE, SIDE);

  const floor = new Mesh(new PlaneGeometry(16, 16), finish.clay());
  const wall = new Mesh(new BoxGeometry(6, 3, 0.2), finish.clay());

  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  wall.position.y = 1.5;
  wall.castShadow = wall.receiveShadow = true;
  studio.scene.add(floor, wall);
  studio.frame(new Vector3(), 10);
  // A clear sun 50° up in the south.
  studio.light(daylight([0, -0.643, 0.766]), theme(false), new Color(0.95, 0.95, 0.96));
  studio.render();

  const pixels = picture(studio);

  /** The picture at a point of the scene. */
  const at = (x: number, y: number, z: number): number => {
    const seen = new Vector3(x, y, z).project(camera);

    return (
      pixels[
        Math.round(((seen.y + 1) / 2) * SIDE) * SIDE + Math.round(((seen.x + 1) / 2) * SIDE)
      ] ?? 0
    );
  };

  const [sunlit, shadowed, shaded] = [at(0, 0, -6), at(0, 0, -1.2), at(0, 1.8, -0.1)];

  // Bright, with headroom: nothing of the model reaches the page's white.
  expect(sunlit).toBeGreaterThan(205);
  expect(sunlit).toBeLessThan(248);
  expect(shadowed).toBeLessThan(sunlit - 50);
  expect(shaded).toBeLessThan(sunlit - 50);
  // Shade keeps its form: never near black.
  expect(Math.min(shadowed, shaded)).toBeGreaterThan(70);
});
