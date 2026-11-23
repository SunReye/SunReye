import { afterEach, expect, test } from "vitest";
import { Color, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Vector3 } from "three";
import { TRIAL_WEATHER } from "../builder/trials.ts";
import { daylight, theme } from "@sunreye/builder/scene/light.ts";
import { drawn } from "@sunreye/builder/scene/quality.ts";
import { Studio } from "@sunreye/builder/scene/studio.ts";
import { sceneWeather } from "../weather/scene-weather.ts";
import type { Falling } from "@sunreye/builder/scene/weather.ts";

let studio: Studio | undefined;

const SIDE = 192;

const RAIN: Falling = { kind: "rain", density: 1, wind: [3, 0] };
const SNOW: Falling = { kind: "snow", density: 1, wind: [0, 0] };

/** An empty plot under a noon sun, seen from its edge at eye height. */
function open(dark = false, midnight = false): Studio {
  const canvas = document.createElement("canvas");
  const camera = new PerspectiveCamera(40, 1, 0.1, 5000);

  if (midnight) camera.position.set(32, 32, 48);
  else camera.position.set(0, 6, 34);
  camera.lookAt(0, 4, 0);
  document.body.append(canvas);
  studio = new Studio(canvas, camera, () =>
    drawn("medium", { capable: false, touch: false, steps: 0, tier: "full" }),
  );
  studio.setSize(SIDE, SIDE);
  studio.frame(new Vector3(), 10);
  studio.light(
    daylight([0, -0.5, midnight ? -0.866 : 0.866]),
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

/** By how much each pixel's green changes once `falling` is in the air, on the light or dark page. */
function changes(falling: Falling, dark: boolean) {
  const opened = open(dark);
  const dry = picture(opened);

  opened.fall(falling, false);

  const lit = picture(opened);

  return { by: lit.map((green, i) => green - (dry[i] ?? 0)), lit };
}

/** How many pixels change by more than `levels` of 255. */
const marked = (by: readonly number[], levels: number): number =>
  by.filter((change) => Math.abs(change) > levels).length;

test("rain reads on the light page: its streaks stand clearly apart from it", () => {
  const { by } = changes(RAIN, false);

  // Well over a twentieth of the picture, by more than a faint tint.
  expect(marked(by, 12)).toBeGreaterThan((SIDE * SIDE) / 20);
});

test("night rain has visible streaks without filling the sky with bright lines", () => {
  const { by } = changes(RAIN, true);

  expect(marked(by, 3)).toBeGreaterThan(SIDE);
  expect(marked(by, 12)).toBeLessThan((SIDE * SIDE) / 25);
});

test.each(["rain", "snow"] as const)(
  "depth of field keeps %s sharp within the focus slice and softens it outside",
  (trial) => {
    const opened = open(true, true);
    const floor = opened.scene.getObjectByName("floor");

    if (floor === undefined) throw new TypeError("no floor");

    floor.visible = false;
    opened.scene.background = new Color(0x20242c);
    const dry = picture(opened);
    const { falling } = sceneWeather(TRIAL_WEATHER[trial]);

    opened.fall(falling, false);

    const wet = picture(opened);

    expect(differing(wet, dry)).toBeGreaterThan(SIDE);

    // The camera above the plot looks down through the full height of the weather field.
    opened.camera.position.set(0, 50, 0);
    opened.camera.up.set(0, 0, -1);
    opened.camera.lookAt(0, 0, 0);
    const sharp = picture(opened);

    const detail = (pixels: readonly number[]) =>
      pixels.reduce((sum, value, i) => {
        const across = i % SIDE > 0 ? value - pixels[i - 1]! : 0;
        const up = i >= SIDE ? value - pixels[i - SIDE]! : 0;

        return sum + across ** 2 + up ** 2;
      }, 0);

    opened.focus({ tiltShift: false, depthOfField: true });
    opened.frame(new Vector3(0, -30, 0), 10);
    const outside = picture(opened);
    opened.frame(new Vector3(0, 15, 0), 10);
    const through = picture(opened);

    expect(detail(outside)).toBeLessThan(detail(sharp) * 0.7);
    expect(detail(through)).toBeGreaterThan(detail(outside) * 1.3);

    opened.focus({ tiltShift: false, depthOfField: false });
    expect(differing(picture(opened), sharp)).toBe(0);
  },
);

test("precipitation behind a surface stays hidden with depth of field on", () => {
  const opened = open(true);
  const wall = new Mesh(new PlaneGeometry(3, 4), new MeshBasicMaterial({ color: 0x20242c }));

  // The weather volume ends at z = 60. The wall is between it and the camera.
  opened.camera.position.set(0, 6, 85);
  opened.camera.lookAt(0, 6, 0);
  wall.position.set(0, 6, 77);
  opened.scene.add(wall);
  opened.focus({ tiltShift: false, depthOfField: true });
  const dry = picture(opened);

  opened.fall(SNOW, false);
  const wet = picture(opened);

  const centre = (i: number) => {
    const x = i % SIDE;
    const y = Math.floor(i / SIDE);

    return Math.abs(x - SIDE / 2) < SIDE / 6 && Math.abs(y - SIDE / 2) < SIDE / 6;
  };

  expect(differing(wet, dry)).toBeGreaterThan(SIDE);
  expect(
    differing(
      wet.filter((_, i) => centre(i)),
      dry.filter((_, i) => centre(i)),
    ),
  ).toBe(0);
});

test("snow reads on the white page by its shaded side, and its flakes are white", () => {
  const light = changes(SNOW, false);

  expect(marked(light.by, 12)).toBeGreaterThan((SIDE * SIDE) / 80);
  // A shade, not a blot.
  expect(Math.min(...light.by)).toBeGreaterThan(-110);

  const dark = changes(SNOW, true);
  const flakes = dark.lit.filter((_, i) => (dark.by[i] ?? 0) > 12);

  expect(Math.max(...flakes)).toBeGreaterThan(225);
});
