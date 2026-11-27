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
import { additions } from "../../../../../../packages/builder/src/builder/additions.ts";
import { overlay } from "../../../../../../packages/builder/src/builder/overlay.ts";
import { loadPv } from "@sunreye/pv-wasm";
import {
  type Block,
  type FreeForm,
  type Scene,
} from "../../../../../../packages/builder/src/builder/pv.ts";
import { buildScene } from "../../../../../../packages/builder/src/builder/scene.ts";

// Free-form roofs drawn (ADR 20): the pv crate's faces and walls, convex or not, as the builder
// draws them.

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));
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

test("a wall only partly under a face is drawn up to it there and not past it", () => {
  const box: readonly (readonly [number, number])[] = [
    [0, 0],
    [0, 4],
    [10, 4],
    [10, 0],
  ];

  // The face stands over the west 6 m only.
  const drawn = buildScene(
    pv.geometry(
      scene({
        footprint: box,
        faces: [
          [
            [0, 3, 0],
            [0, 3, 4],
            [6, 3, 4],
            [6, 3, 0],
          ],
        ],
      }),
    ),
  );

  // The long sides 6 m at 3 m, the west end 4 m at 3 m; the east end has none.
  expect(covered(drawn, "wall")).toBeCloseTo(2 * 18 + 12, 6);
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

/** The L under one face falling 1 m in 4 to the south, filled with one string's modules, and
 * whatever else stands on the plot. */
function sloped(...obstacles: Scene["obstacles"]): Scene {
  const face = L.map(([x, z]) => [x, 5 - z / 4, z]);
  const grid = { block: 0, face: 0, moduleType: 7, landscape: false, setback: 0.3 };
  const bare = { ...scene({ footprint: L, faces: [face] }), grids: [{ ...grid, modules: [] }] };

  const places = pv.fillFace({
    scene: bare,
    sizes: { 7: { width: 1.134, height: 1.722 } },
    grid: 0,
  });

  const modules = places.map(([across, up]) => ({
    across,
    up,
    landscape: false,
    optimized: false,
    string: 0,
  }));

  return { ...bare, obstacles, grids: [{ ...grid, modules }] };
}

test("modules laid on a non-convex free-form face are lit, and shaded as on any face", () => {
  const modules = sloped().grids?.[0]?.modules.length ?? 0;

  const datasheet = {
    id: 7,
    name: "Owner 400",
    pmax: 400,
    vmp: 34,
    imp: 11.76,
    voc: 41,
    isc: 12.5,
    powerCoefficient: -0.35,
    voltageCoefficient: -0.27,
    currentCoefficient: 0.05,
    width: 1.134,
    height: 1.722,
    bypassDiodes: 3,
  };

  const wired = { name: "", moduleType: 7, device: 1, input: 1, modules, optimized: 0, loss: 2 };

  // 2026-06-21 11:00 UTC over Berlin.
  const lit = (on: Scene): number =>
    pv.clearSky({
      location: { latitude: 52.52, longitude: 13.38 },
      scene: on,
      moduleTypes: [datasheet],
      strings: [{ ...wired, tilt: 14, azimuth: 180 }],
      times: [1_782_039_600],
    })[0]?.[0] ?? 0;

  // A wall 20 m high just south of the house.
  const wall = { kind: "box", x: -5, z: 10, width: 20, depth: 1, height: 20, rotation: 0 } as const;
  const open = lit(sloped());

  expect(modules).toBeGreaterThan(10);
  expect(open).toBeGreaterThan(modules * 200);
  expect(lit(sloped(wall))).toBeLessThan(open / 2);
});

/** The blocks the equipment group's markers would hang on, the first device's. */
function markedOn(...blocks: readonly Block[]): number[] {
  const draft = { scene: { north: 0, blocks, obstacles: [] }, strings: [] };

  const plan = {
    draft,
    laid: pv.modules(draft.scene, {}),
    pv,
    sizes: {},
    devices: [{ id: 1, name: "Deye", profile: "deye-sg05lp3", connection: 1, unit: 1 }],
    cold: [],
    sized: [],
    inputs: {},
    refused: null,
  };

  return additions("equipment", plan, 7).flatMap(
    ({ draft: { scene: added } }) => added.equipment?.map(({ block }) => block) ?? [],
  );
}

test("an inverter or battery marker is added to the first block with four walls, else to none", () => {
  const free: Block = { ...freeBlock({ footprint: L, faces: [] }), width: 10, depth: 8, eave: 3 };
  const { freeForm, ...walled } = free;

  expect(freeForm).toBeDefined();
  expect(markedOn(free, walled)).toEqual([1, 1]);
  expect(markedOn(free)).toEqual([]);
});
