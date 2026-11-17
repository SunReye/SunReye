import { afterEach, expect, test } from "vitest";
import { Color, PerspectiveCamera, Vector3 } from "three";
import { daylight, theme } from "./light.ts";
import { drawn, type Level } from "./quality.ts";
import { Studio } from "./studio.ts";
import type { Glass } from "./weather.ts";

let studio: Studio | undefined;

const SIDE = 192;

const CLEAR: Glass = { rain: 0, snow: 0, frost: 0 };
const RAIN: Glass = { ...CLEAR, rain: 1 };
const SNOW: Glass = { ...CLEAR, snow: 1 };
const FROST: Glass = { ...CLEAR, frost: 1 };

/** An empty plot under a noon sun, seen from its edge at eye height. */
function open(dark = false, level: Level = "medium"): Studio {
  const canvas = document.createElement("canvas");
  const camera = new PerspectiveCamera(40, 1, 0.1, 5000);

  camera.position.set(0, 6, 34);
  camera.lookAt(0, 4, 0);
  document.body.append(canvas);
  studio = new Studio(canvas, camera, () => drawn(level, { capable: false, steps: 0, tier: "full" }));
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

/** Whether pixel `i` lies in the middle of the picture: the box of half its side. */
function middle(i: number): boolean {
  const [x, y] = [i % SIDE, Math.floor(i / SIDE)];
  const within = (v: number): boolean => v >= SIDE / 4 && v < (SIDE * 3) / 4;

  return within(x) && within(y);
}

/** How many pixels of two pictures differ to the eye, in the middle and around it. */
function differing(a: readonly number[], b: readonly number[]) {
  const differs = a.map((v, i) => Math.abs(v - (b[i] ?? 0)) > 2);

  return {
    middle: differs.filter((differ, i) => differ && middle(i)).length,
    around: differs.filter((differ, i) => differ && !middle(i)).length,
  };
}

/** Seconds of the weather loop: a bead that runs is never in the middle at any of them. */
const SECONDS = [0, 3.7, 11.2, 47.9];

test.each([
  ["rain", RAIN, false],
  ["snow", SNOW, false],
  ["frost", FROST, false],
  ["rain on the dark page", RAIN, true],
  ["snow on the dark page", SNOW, true],
  ["frost on the dark page", FROST, true],
])("%s is on the lens at the edges, and the middle stays as it was", (_, glass, dark) => {
  const opened = open(dark);
  const clear = picture(opened);

  for (const seconds of SECONDS) {
    opened.lens(glass, seconds);

    const { middle: within, around } = differing(picture(opened), clear);

    expect([seconds, within]).toEqual([seconds, 0]);
    expect(around).toBeGreaterThan(SIDE * 2);
  }

  opened.lens(null, 0);
  expect(differing(picture(opened), clear)).toEqual({ middle: 0, around: 0 });
});

test("rain is sparse: most of the picture around the middle is as it was", () => {
  const opened = open();
  const clear = picture(opened);

  opened.lens(RAIN, 5);
  expect(differing(picture(opened), clear).around).toBeLessThan((SIDE * SIDE * 3) / 4 / 3);
});

test("the less of it, the less is on the lens", () => {
  const opened = open();
  const clear = picture(opened);

  const shown = (glass: Glass): number => {
    opened.lens(glass, 5);

    return differing(picture(opened), clear).around;
  };

  for (const whole of [RAIN, SNOW, FROST]) {
    const scaled = { rain: whole.rain * 0.3, snow: whole.snow * 0.3, frost: whole.frost * 0.3 };

    expect(shown(scaled)).toBeGreaterThan(0);
    expect(shown(scaled)).toBeLessThan(shown(whole) * 0.7);
  }
});

test("rain runs by the loop's seconds alone, and frost stands", () => {
  const opened = open();

  opened.lens(RAIN, 2);

  const still = picture(opened);

  expect(differing(picture(opened), still).around).toBe(0);

  opened.lens(RAIN, 2.5);
  expect(differing(picture(opened), still).around).toBeGreaterThan(SIDE / 4);

  // The same second, the same picture: nothing is drawn by chance.
  opened.lens(RAIN, 2);
  expect(differing(picture(opened), still).around).toBe(0);

  opened.lens(FROST, 2);

  const frozen = picture(opened);

  opened.lens(FROST, 30);
  expect(differing(picture(opened), frozen).around).toBe(0);
});

test("Niedrig draws no glass", () => {
  const opened = open(false, "low");
  const clear = picture(opened);

  opened.lens(RAIN, 5);
  expect(differing(picture(opened), clear)).toEqual({ middle: 0, around: 0 });

  // Chosen higher, it shows at once.
  opened.follow(drawn("medium", { capable: false, steps: 0, tier: "full" }));
  opened.setSize(SIDE, SIDE);

  const sharper = picture(opened);

  opened.lens(null, 0);
  expect(differing(sharper, picture(opened)).around).toBeGreaterThan(SIDE * 2);
});

test("the glass bends the picture alone: the canvas and the camera a pointer is cast through are as they were", () => {
  const opened = open();
  const { camera, renderer } = opened;
  const facts = (): unknown => [
    renderer.domElement.width,
    renderer.domElement.height,
    renderer.getPixelRatio(),
    camera.projectionMatrix.toArray(),
    camera.matrixWorld.toArray(),
    camera.view,
  ];

  opened.render();

  const before = JSON.stringify(facts());

  opened.lens({ rain: 1, snow: 1, frost: 1 }, 5);
  opened.render();
  expect(JSON.stringify(facts())).toBe(before);
});

test("warmed, the glass first shows without a program made then", () => {
  const opened = open();

  opened.warm();
  opened.render();

  const made = opened.renderer.info.programs?.length;

  opened.lens(RAIN, 1);
  opened.render();
  expect(opened.renderer.info.programs?.length).toBe(made);
});
