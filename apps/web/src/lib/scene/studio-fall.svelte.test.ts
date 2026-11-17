import { afterEach, expect, test } from "vitest";
import { Color, PerspectiveCamera, Vector3 } from "three";
import { daylight, theme } from "./light.ts";
import { drawn } from "./quality.ts";
import { Studio } from "./studio.ts";
import type { Falling } from "./weather.ts";

let studio: Studio | undefined;

const SIDE = 192;

const RAIN: Falling = { kind: "rain", density: 1, wind: [3, 0] };
const SNOW: Falling = { kind: "snow", density: 1, wind: [0, 0] };

/** An empty plot under a noon sun, seen from its edge at eye height. */
function open(dark = false): Studio {
  const canvas = document.createElement("canvas");
  const camera = new PerspectiveCamera(40, 1, 0.1, 5000);

  camera.position.set(0, 6, 34);
  camera.lookAt(0, 4, 0);
  document.body.append(canvas);
  studio = new Studio(canvas, camera, () =>
    drawn("medium", { capable: false, steps: 0, tier: "full" }),
  );
  studio.setSize(SIDE, SIDE);
  studio.frame(new Vector3(), 10);
  studio.light(
    daylight([0, -0.5, 0.866]),
    theme(dark),
    dark ? new Color(0.01, 0.012, 0.016) : new Color(0.95, 0.95, 0.96),
  );

  return studio;
}

afterEach(() => {
  studio?.renderer.domElement.remove();
  studio?.dispose();
  studio = undefined;
});

/** The picture drawn now, as its green channel. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
function picture(opened: Studio): number[] {
  opened.render();

  const gl = opened.renderer.getContext();
  const pixels = new Uint8Array(SIDE * SIDE * 4);

  gl.readPixels(0, 0, SIDE, SIDE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  return Array.from({ length: SIDE * SIDE }, (_, i) => pixels[i * 4 + 1] ?? 0);
}

/** How many pixels of two pictures differ to the eye. */
const differing = (a: readonly number[], b: readonly number[]): number =>
  a.filter((v, i) => Math.abs(v - (b[i] ?? 0)) > 2).length;

test.each([
  ["rain", RAIN, false],
  ["snow", SNOW, false],
  ["rain on the dark page", RAIN, true],
  ["snow on the dark page", SNOW, true],
])("%s shows in the scene's own render, and nothing of it is left once dry", (_, falling, dark) => {
  const opened = open(dark);
  const dry = picture(opened);

  opened.fall(falling, false);
  expect(differing(picture(opened), dry)).toBeGreaterThan(SIDE);
  // The middle of the plot stays readable: most of the picture is as it was.
  expect(differing(picture(opened), dry)).toBeLessThan((SIDE * SIDE) / 3);

  opened.fall(null, false);
  expect(differing(picture(opened), dry)).toBe(0);
});

test("what falls moves by the loop's seconds alone: a frame drawn again is the same picture", () => {
  const opened = open();

  opened.fall(RAIN, false);

  const still = picture(opened);

  expect(differing(picture(opened), still)).toBe(0);

  opened.drift(0.4);

  const moved = picture(opened);

  expect(differing(moved, still)).toBeGreaterThan(SIDE);

  // The same second, the same picture: nothing is drawn by chance.
  opened.drift(0);
  expect(differing(picture(opened), still)).toBe(0);
});

test("the more falls the denser the field, and the sparse one is a fraction of it", () => {
  const opened = open();
  const dry = picture(opened);

  const shown = (falling: Falling, sparse: boolean): number => {
    opened.fall(falling, sparse);

    return differing(picture(opened), dry);
  };

  const whole = shown(SNOW, false);

  expect(shown({ ...SNOW, density: 0.3 }, false)).toBeLessThan(whole * 0.6);
  expect(shown(SNOW, true)).toBeLessThan(whole * 0.5);
  expect(shown(SNOW, true)).toBeGreaterThan(0);
});
