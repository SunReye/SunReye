/// <reference types="bun" />
// The handles as the screen shows them (ADR 20): on an object too small to see they hide, so a
// press on it moves it; else the ring and the arrows stand a fingertip clear of it on screen.
import { expect, test } from "bun:test";
import { Color, type Object3D, Vector3 } from "three";
import { loadPv } from "@sunreye/pv-wasm";
import type { Scene } from "../../../../../../../packages/builder/src/builder/pv.ts";
import {
  gizmo,
  handleIn,
} from "../../../../../../../packages/builder/src/builder/handles/gizmo.ts";
import {
  handles,
  type Triple,
} from "../../../../../../../packages/builder/src/builder/handles/grips.ts";
import { fit, GAP } from "../../../../../../../packages/builder/src/builder/handles/screen.ts";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

/** A 10 m × 8 m gable at 35°, a 0.6 m square chimney on its south face. */
const scene: Scene = {
  north: 0,
  blocks: [
    { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 35 } },
  ],
  obstacles: [],
  chimneys: [{ block: 0, face: 1, across: 5, up: 2, width: 0.6, depth: 0.6, height: 1 }],
};

const found = handles(scene, { kind: "chimney", index: 0 }, pv.modules(scene, {}));

/** Seen from straight above, `scale` pixels a metre. */
const above =
  (scale: number) =>
  ([x, , z]: Triple) =>
    [x * scale, z * scale] as const;

/** The pixels between two points of three.js's frame, seen as `scale` pixels a metre. */
const apart = (scale: number, a: Readonly<Vector3>, b: Readonly<Vector3>) =>
  Math.hypot(a.x - b.x, a.z - b.z) * scale;

/** Each handle's group by its grip, fitted to the screen at `scale` pixels a metre. */
function fitted(scale: number) {
  const drawn = gizmo(found, new Color("#f00"));

  fit(drawn, above(scale));

  const of = (grip: string) =>
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three's groups, read only.
    drawn.children.find((group: Object3D) => handleIn(group)?.grip === grip);

  return { ring: of("turn"), width: of("width"), move: of("move") };
}

test("on a chimney some 6 px across the ring and the arrows hide; its outline stays", () => {
  const { ring, width, move } = fitted(10);

  expect(ring?.visible).toBe(false);
  expect(width?.visible).toBe(false);
  expect(move?.visible).toBe(true);
});

test("near, the ring and the arrows stand where they are", () => {
  const { ring, width } = fitted(100);

  expect(ring?.visible).toBe(true);
  expect(ring?.scale.x).toBe(1);
  const [x, y, z] = found.find(({ grip }) => grip === "width")?.at ?? [];

  expect([width?.position.x, width?.position.y, width?.position.z]).toEqual([x, y, z]);
});

/** `value`, which the test's setup gives. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing from the setup");

  return value;
}

test("a little farther, the ring grows and the arrow stands off, a fingertip clear of it", () => {
  const scale = 45;
  const fitting = fitted(scale);
  const [ring, width] = [must(fitting.ring), must(fitting.width)];
  const { radius = 0, inner = 0 } = must(found.find(({ grip }) => grip === "turn"));
  const { edge = [0, 0, 0] } = must(found.find(({ grip }) => grip === "width"));

  expect([ring.visible, width.visible]).toEqual([true, true]);
  expect(ring.scale.x).toBeGreaterThan(1);
  expect(radius * ring.scale.x * scale).toBeGreaterThanOrEqual(inner * scale + GAP - 1e-6);
  expect(apart(scale, width.position, new Vector3(...edge))).toBeGreaterThanOrEqual(GAP - 1e-6);
});
