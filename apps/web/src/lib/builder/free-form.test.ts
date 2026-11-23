/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  Vector3,
  type Group,
  type Object3D,
} from "three";
import { overlay } from "./overlay.ts";
import { loadPv, type Block, type FreeForm, type Scene } from "./pv.ts";
import { buildScene } from "./scene.ts";

// Free-form roofs drawn (ADR 20): the pv crate's faces and walls, convex or not, as the builder
// draws them.

// The release build the gate and the SPA build produce (crates/pv-wasm).
const wasm = new URL(
  "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm",
  import.meta.url,
);

const pv = await loadPv(await Bun.file(wasm).bytes());

/** A block that is only its free-form part. */
function freeBlock(freeForm: FreeForm): Block {
  return { x: 0, z: 0, width: 0, depth: 0, eave: 0, rotation: 0, roof: { kind: "flat" }, freeForm };
}

const scene = (...blocks: readonly FreeForm[]): Scene => ({
  north: 0,
  blocks: blocks.map((free) => freeBlock(free)),
  obstacles: [],
});

/** The square metres a mesh covers, triangle by triangle; none for anything else. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function area(object: Object3D): number {
  const geometry: unknown = object instanceof Mesh ? object.geometry : undefined;

  const position: unknown =
    geometry instanceof BufferGeometry ? geometry.getAttribute("position") : null;

  if (!(position instanceof BufferAttribute)) return 0;

  const corner = (at: number): Vector3 => new Vector3().fromBufferAttribute(position, at);
  let total = 0;

  for (let i = 0; i < position.count; i += 3) {
    const a = corner(i);

    total +=
      corner(i + 1)
        .sub(a)
        .cross(corner(i + 2).sub(a))
        .length() / 2;
  }

  return total;
}

/** The square metres a group's meshes of `name` cover. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
const covered = (group: Group, name: string): number =>
  group
    .getObjectsByProperty("name", name)
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
    .reduce((sum, object) => sum + area(object), 0);

/** An L of 10 m by 8 m, its notch 6 m by 4 m, counter-clockwise seen from above from a corner the
 * notch hides from. */
const L: readonly (readonly [number, number])[] = [
  [10, 0],
  [0, 0],
  [0, 8],
  [4, 8],
  [4, 4],
  [10, 4],
];

test("an L-shaped house under a free-form roof is drawn with a wall up to the roof on every side", () => {
  // Each wing falls to its outer eave at 3 m and rises to 5 m at the notch; they meet in a hip.
  const drawn = buildScene(
    pv.geometry(
      scene({
        footprint: L,
        faces: [
          [
            [0, 3, 0],
            [4, 5, 4],
            [10, 5, 4],
            [10, 3, 0],
          ],
          [
            [0, 3, 0],
            [0, 3, 8],
            [4, 5, 8],
            [4, 5, 4],
          ],
        ],
      }),
    ),
  );

  // The eaves 10 m and 8 m at 3 m, the notch's sides 6 m and 4 m at 5 m, the ends 4 m from 3 to
  // 5 m.
  expect(covered(drawn, "wall")).toBeCloseTo(30 + 24 + 30 + 20 + 2 * 16, 6);
  // 56 m² in plan at a slope of one in two.
  expect(covered(drawn, "roof")).toBeCloseTo(56 * Math.hypot(1, 0.5), 6);
});

test("a non-convex free-form face is drawn over its own area, not fanned past its notch", () => {
  const drawn = buildScene(
    pv.geometry(scene({ footprint: L, faces: [L.map(([x, z]) => [x, 3, z])] })),
  );

  expect(covered(drawn, "flat")).toBeCloseTo(56, 6);
});

test("a wall stepping up under two faces is drawn over its own area", () => {
  const drawn = buildScene(
    pv.geometry(
      scene({
        footprint: [
          [0, 0],
          [0, 4],
          [10, 4],
          [10, 0],
        ],
        faces: [
          [
            [0, 3, 0],
            [0, 3, 4],
            [5, 3, 4],
            [5, 3, 0],
          ],
          [
            [5, 4, 0],
            [5, 4, 4],
            [10, 4, 4],
            [10, 4, 0],
          ],
        ],
      }),
    ),
  );

  // Its long sides 5 m at 3 m and 5 m at 4 m, its ends 4 m at 3 m and at 4 m.
  expect(covered(drawn, "wall")).toBeCloseTo(2 * 35 + 12 + 16, 6);
});

test("a level free-form face is drawn flat though its first corners lie in a line", () => {
  const face = [[10, 3, 0], [5, 3, 0], ...L.slice(1).map(([x, z]) => [x, 3, z])];

  expect(
    covered(buildScene(pv.geometry(scene({ footprint: L, faces: [face] }))), "flat"),
  ).toBeCloseTo(56, 6);
});

test("a non-convex face its setback leaves no roof on is shaded over its own area", () => {
  const shade = {
    modules: [],
    outline: L.map(([e, n]) => [e, n, 3] as const),
    inset: null,
    blocked: [],
  };

  const tints = { brand: new Color(0x00ff00), unfit: new Color(0xff0000) };
  const shown = overlay({ kind: "modules", shade }, tints);

  for (const part of shown.children) part.name = "shade";

  expect(covered(shown, "shade")).toBeCloseTo(56, 2);
});
