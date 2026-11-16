import { afterEach, expect, test } from "vitest";
import { BoxGeometry, Color, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from "three";
import { daylight, theme } from "./light.ts";
import { drawn, type Level } from "./quality.ts";
import { Studio } from "./studio.ts";

let studio: Studio | undefined;

afterEach(() => {
  studio?.dispose();
  studio = undefined;
});

/** What a level draws, on any device. */
const look = (level: Level) => drawn(level, { capable: false, steps: 0, tier: "full" });

const mean = (some: readonly number[]): number => some.reduce((sum, v) => sum + v, 0) / some.length;

const shades = (some: readonly number[]): number => new Set(some).size;

const SIDE = 256;

/** A 6 m post on a pale floor under a low sun from the east, seen from straight above its shadow. */
function post(level: Level): Studio {
  const canvas = document.createElement("canvas");
  const camera = new PerspectiveCamera(40, 1, 0.1, 500);

  camera.position.set(-6, 30, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(-6, 0, 0);
  studio?.dispose();
  studio = new Studio(canvas, camera, () => look(level));
  studio.setSize(SIDE, SIDE);

  const floor = new Mesh(
    new BoxGeometry(60, 0.2, 60),
    new MeshStandardMaterial({ color: 0xcccccc }),
  );

  const upright = new Mesh(new BoxGeometry(1, 6, 1), new MeshStandardMaterial());

  floor.position.y = -0.1;
  floor.receiveShadow = true;
  upright.position.y = 3;
  // Turned, so its edges run aslant across the pixels.
  upright.rotation.y = 0.35;
  upright.castShadow = true;
  studio.scene.add(floor, upright);
  studio.frame(new Vector3(-5, 0, 0), 10);
  studio.light(daylight([1, 0, 0.5]), theme(false), new Color(0.95, 0.95, 0.96));
  studio.render();

  return studio;
}

/** The picture on the canvas, as its red channel row by row. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
function picture(opened: Studio): number[] {
  const gl = opened.renderer.getContext();
  const pixels = new Uint8Array(SIDE * SIDE * 4);

  gl.readPixels(0, 0, SIDE, SIDE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  return Array.from({ length: SIDE * SIDE }, (_, i) => pixels[i * 4] ?? 0);
}

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
    light.filter((v) => v > dark + (lit - dark) * 0.15 && v < lit - (lit - dark) * 0.15).length / 2
  );
}

test("Hoch's shadow is sharp where it touches its caster and widens with the distance", () => {
  const opened = post("high");
  const [near, far] = [fade(opened, 1.5), fade(opened, 10)];

  expect(near).toBeLessThanOrEqual(1);
  expect(far).toBeGreaterThanOrEqual(near + 1);
});

test("Mittel's shadow blurs alike along its length", () => {
  const opened = post("medium");

  expect(Math.abs(fade(opened, 10) - fade(opened, 1.5))).toBeLessThanOrEqual(1);
});

test("Ultra's burst smooths the edges of the picture it settles on, and changes nothing else", () => {
  const opened = post("ultra");
  const settled = picture(opened);

  while (opened.refine());

  const refined = picture(opened);

  // The same picture: no brighter, no darker, nothing moved.
  expect(Math.abs(mean(refined) - mean(settled))).toBeLessThan(0.5);
  // Finer steps along its slanted edges than four samples a pixel give.
  expect(shades(refined)).toBeGreaterThan(shades(settled) * 1.5);
});
