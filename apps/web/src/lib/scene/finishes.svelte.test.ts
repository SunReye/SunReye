import { afterEach, expect, test } from "vitest";
import {
  Color,
  Mesh,
  type MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from "three";
import { daylight, theme } from "./light.ts";
import { soiled } from "./decals.ts";
import * as finish from "./materials.ts";
import { drawn, type Level } from "./quality.ts";
import { Studio } from "./studio.ts";

let studio: Studio | undefined;

afterEach(() => {
  studio?.dispose();
  studio = undefined;
});

/** Every finish that weathers or varies, by name. */
const FINISHES = [
  () => finish.plaster("#d8c8b0"),
  () => finish.tiles(),
  () => finish.render(),
  finish.bark,
  finish.leaves,
  soiled,
  ...Object.values(finish.GROUND),
] satisfies readonly (() => MeshStandardMaterial)[];

/** A studio and the shader errors it has met. */
interface Sheets {
  readonly opened: Studio;
  readonly failed: string[];
}

/** A studio at `level` looking down on a 12 m sheet of each finish, lit by a high sun. */
function sheets(level: Level): Sheets {
  const camera = new PerspectiveCamera(40, 1, 0.1, 500);
  const failed: string[] = [];

  camera.position.set(0, 30, 0);
  camera.lookAt(0, 0, 0);

  const opened = new Studio(document.createElement("canvas"), camera, () =>
    drawn(level, { capable: false, steps: 0, tier: "full" }),
  );

  studio = opened;
  opened.setSize(64, 64);
  opened.frame(new Vector3(), 10);
  opened.light(daylight([0.3, -0.4, 0.86]), theme(false), new Color(0.95, 0.95, 0.96));

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the browser's own.
  opened.renderer.debug.onShaderError = (gl, _program, _vertex, fragment) => {
    failed.push(gl.getShaderInfoLog(fragment) ?? level);
  };

  for (const [i, make] of FINISHES.entries()) {
    const sheet = new Mesh(new PlaneGeometry(12, 12), make());

    sheet.rotation.x = -Math.PI / 2;
    sheet.position.y = i * 0.01;
    sheet.receiveShadow = true;
    opened.scene.add(sheet);
  }

  return { opened, failed };
}

test("every finish's program is sound at every level", () => {
  for (const level of ["low", "medium", "high", "ultra"] as const) {
    studio?.dispose();

    const { opened, failed } = sheets(level);

    opened.render();

    expect([level, failed]).toEqual([level, []]);
  }
});

const SIDE = 256;

/** Pixels a repeat of `metres` spans in the picture below. */
const SPAN = 32;

/** A 16 m sheet of `material`, its map repeating every `metres`, seen from straight above so
 * that one repeat spans a whole number of pixels: the picture's red channel, row by row. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
function seen(level: Level, material: MeshStandardMaterial, metres: number): number[] {
  const camera = new PerspectiveCamera(40, 1, 0.1, 500);
  const across = (SIDE / SPAN) * metres;

  camera.position.set(0, across / 2 / Math.tan(Math.PI / 9), 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  studio?.dispose();
  studio = new Studio(document.createElement("canvas"), camera, () =>
    drawn(level, { capable: false, steps: 0, tier: "full" }),
  );
  studio.setSize(SIDE, SIDE);

  const sheet = new Mesh(new PlaneGeometry(across * 1.2, across * 1.2), material);
  const uv = sheet.geometry.getAttribute("uv");

  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * across * 1.2) / metres, (uv.getY(i) * across * 1.2) / metres);
  }

  sheet.rotation.x = -Math.PI / 2;
  studio.scene.add(sheet);
  studio.light(daylight([0.3, -0.4, 0.86]), theme(false), new Color(0.95, 0.95, 0.96));
  studio.render();

  const gl = studio.renderer.getContext();
  const pixels = new Uint8Array(SIDE * SIDE * 4);

  gl.readPixels(0, 0, SIDE, SIDE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  return Array.from({ length: SIDE * SIDE }, (_, i) => pixels[i * 4] ?? 0);
}

/** How far the picture differs from itself one repeat further on, in levels of 255. */
function apart(picture: readonly number[]): number {
  let [sum, count] = [0, 0];

  for (let y = 0; y < SIDE; y++)
    for (let x = 0; x + SPAN < SIDE; x++) {
      sum += Math.abs((picture[y * SIDE + x] ?? 0) - (picture[y * SIDE + x + SPAN] ?? 0));
      count += 1;
    }

  return sum / count;
}

test("from Mittel up no finish shows its map's repeat; Niedrig draws each as it is", () => {
  const finishes = [
    [finish.tiles, finish.REPEAT.tiles[0]],
    [finish.lawn, finish.REPEAT.lawn[0]],
    [finish.GROUND.paving, finish.REPEAT.paving[0]],
    [() => finish.plaster(), finish.REPEAT.plaster[0]],
  ] as const;

  for (const [make, metres] of finishes) {
    const [plain, varied] = [
      apart(seen("low", make(), metres)),
      apart(seen("medium", make(), metres)),
    ];

    // The map alone comes round again: a repeat on, the picture is itself.
    expect(plain).toBeLessThan(1.5);
    expect(varied).toBeGreaterThan(plain + 3);
  }
});
