/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type Group,
  InstancedMesh,
  type Intersection,
  Matrix4,
  type Object3D,
  PerspectiveCamera,
  Raycaster,
  Vector3,
} from "three";
import type { Geometry, Point } from "../../../../../../packages/builder/src/builder/pv.ts";
import {
  buildScene,
  strike,
  stringColour,
  tint,
  toThree,
  type Panel,
} from "../../../../../../packages/builder/src/builder/scene.ts";

// All placed modules are one instanced draw (ADR 20 Rendering), each where its corners lie.

/** A roof pitched to the south: it rises 4 m over 8 m of depth. */
const house: Geometry = {
  faces: [
    {
      surface: "roof",
      corners: [
        [0, 0, 3],
        [12, 0, 3],
        [12, -8, 7],
        [0, -8, 7],
      ],
    },
  ],
  solids: [],
};

/** Where the roof is at `east`, `north`. */
const onRoof = (east: number, north: number): Point => [east, north, 3 - north / 2];

/** A module from `east`, `north`, `across` wide to the east and `down` long to the south. */
function laid(east: number, north: number, [across, down]: readonly [number, number]): Point[] {
  return [
    onRoof(east, north),
    onRoof(east + across, north),
    onRoof(east + across, north - down),
    onRoof(east, north - down),
  ];
}

/** Portrait and landscape, each with its corners wound both ways and begun at either end. */
const panels: Panel[] = [
  { corners: laid(1, -1, [1, 1.7]), string: 0, grid: 0, module: 0 },
  { corners: laid(3, -1, [1, 1.7]).toReversed(), string: 1, grid: 0, module: 1 },
  { corners: laid(5, -1, [1.7, 1]), string: null, grid: 1, module: 0 },
  { corners: laid(8, -1, [1.7, 1]).toReversed(), string: 2, grid: 1, module: 1, bright: true },
];

const point = (at: Point): Vector3 => new Vector3(...toThree(at));

/** The modules' one mesh: what a ray strikes, how many it draws, where each, and their body's
 * corners and their glows as it carries them. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own group.
function modules(group: Group) {
  const [mesh, ...more] = group.getObjectsByProperty("name", "module");

  if (!(mesh instanceof InstancedMesh) || more.length > 0) throw new TypeError("not one mesh");

  const geometry: unknown = mesh.geometry;
  const count: unknown = mesh.count;

  if (!(geometry instanceof BufferGeometry)) throw new TypeError("no geometry");

  /** An attribute's values, three to an item. */
  const triples = (name: string): number[][] => {
    const found: unknown = geometry.getAttribute(name);

    if (!(found instanceof BufferAttribute)) throw new TypeError(`no ${name}`);

    return Array.from({ length: found.count }, (_, i) => [
      found.getX(i),
      found.getY(i),
      found.getZ(i),
    ]);
  };

  const target: Object3D = mesh;

  return {
    target,
    count,
    corners: triples("position"),
    glows: triples("moduleGlow"),
    /** Where module `i`'s body goes. */
    placed: (i: number): Matrix4 => {
      const at = new Matrix4();

      mesh.getMatrixAt(i, at);

      return at;
    },
  };
}

/** Out of the roof, square to it, in three.js's frame: it rises 1 in 2 to the south. */
const OUT = new Vector3(0, 2, -1).normalize();

/** What a ray square onto the roof at `at` strikes first among the modules. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own group.
function under(group: Group, at: Point): Intersection {
  const ray = new Raycaster(point(at).addScaledVector(OUT, 5), OUT.clone().negate());
  const [hit] = ray.intersectObject(modules(group).target);

  if (hit === undefined) throw new TypeError("no module there");

  return hit;
}

/** A point of a module: `along` of the way from its first corner to its second, `aside` to its
 * last. */
function within({ corners: [a, b, , d] }: Panel, along: number, aside: number): Point {
  if (a === undefined || b === undefined || d === undefined) throw new TypeError("no corners");

  const at = (i: 0 | 1 | 2): number => a[i] + (b[i] - a[i]) * along + (d[i] - a[i]) * aside;

  return [at(0), at(1), at(2)];
}

test("all placed modules are one instanced mesh, and no module is none", () => {
  const { target, count } = modules(buildScene(house, panels));

  expect(count).toBe(panels.length);
  expect(target.castShadow).toBe(false);
  expect(target.receiveShadow).toBe(true);
  expect(buildScene(house, []).getObjectsByProperty("name", "module")).toEqual([]);
});

test("each module lies where its corners do, 3.5 cm proud of its roof", () => {
  const group = buildScene(house, panels);

  for (const [i, panel] of panels.entries()) {
    const middle = within(panel, 0.5, 0.5);
    const hit = under(group, middle);

    expect(hit.instanceId).toBe(i);
    expect(hit.point.distanceTo(point(middle))).toBeCloseTo(0.035, 5);
    // Just past each of its edges there is none of it.
    expect(() => under(group, within(panel, -0.02, 0.5))).toThrow();
    expect(() => under(group, within(panel, 0.5, 1.02))).toThrow();
  }
});

test("a module's cells run their long side along its long side, from its first corner", () => {
  const group = buildScene(house, panels);

  // A fifth of the way to each module's second corner and a tenth to its last: u across the
  // short side, v along the long one.
  const cells = panels.map((panel) => {
    const { uv } = under(group, within(panel, 0.2, 0.1));

    return [uv?.x.toFixed(3), uv?.y.toFixed(3)];
  });

  expect(cells).toEqual([
    // Portrait, its corners wound clockwise seen from the sky: the cells are laid mirrored
    // across the short side, as a body is never mirrored itself (it would be lit from below).
    ["0.800", "0.100"],
    ["0.200", "0.100"],
    // Landscape, wound counterclockwise, then clockwise.
    ["0.100", "0.200"],
    ["0.900", "0.200"],
  ]);
});

test("a module's glass faces the sky, wound as it faces: it is lit from above, not from below", () => {
  const group = buildScene(house, panels);
  const { corners, placed } = modules(group);

  for (const [i, panel] of panels.entries()) {
    const { face } = under(group, within(panel, 0.5, 0.5));
    const at = placed(i);

    if (face === null || face === undefined) throw new TypeError("no face");

    const [p, q, r] = [face.a, face.b, face.c].map((index) =>
      new Vector3(...(corners[index] ?? [])).applyMatrix4(at),
    );

    if (p === undefined || q === undefined || r === undefined) throw new TypeError("no triangle");

    // The triangle as drawn winds counter-clockwise seen from the sky.
    expect(q.sub(p).cross(r.sub(p)).normalize().dot(OUT)).toBeCloseTo(1, 5);
    // And its normal, carried as three.js carries an instance's, points the same way.
    expect(face.normal.clone().transformDirection(at).dot(OUT)).toBeCloseTo(1, 5);
  }
});

/** Each module's glow as drawn: its colour times its strength, linear. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own group.
const glows = (group: Group): number[][] => modules(group).glows;

/** `hex` at a strength of `by`, as a buffer of floats holds it. */
const scaled = (hex: number, by: number): number[] => [
  ...new Float32Array(new Color(hex).multiplyScalar(by).toArray()),
];

test("in the builder each module glows faintly in its own string's colour, and brightly while wired", () => {
  const drawn = glows(buildScene(house, panels));

  expect(drawn[0]).toEqual(scaled(stringColour(0), 0.3));
  expect(drawn[1]).toEqual(scaled(stringColour(1), 0.3));
  expect(drawn[2]).toEqual(scaled(stringColour(null), 0.3));
  expect(drawn[3]).toEqual(scaled(stringColour(2), 1));
});

test("live, each module glows in the solar colour by its own string's share", () => {
  const group = buildScene(house, panels);

  tint(group, [1, 0.5, null, 0], { colour: 0xffa63a, daylight: 1 });

  const [full = [], half = [], none, idle] = glows(group);

  expect(full).toEqual(scaled(0xffa63a, 0.1));
  expect(half[0]).toBeCloseTo((full[0] ?? 0) / 4, 6);
  expect(none).toEqual([0, 0, 0]);
  expect(idle).toEqual([0, 0, 0]);
});

test("under a closed sky a string that makes little keeps its cell grid: a faint glow, and none by night", () => {
  const group = buildScene(house, panels);
  const strength = (): number[] => glows(group).map((glow: readonly number[]) => glow[0] ?? 0);

  tint(group, [0.12, 0.02, 0, 0.8], { colour: 0xffa63a, daylight: 1 });

  const [little = 0, less, none, much = 0] = strength();

  expect(little).toBeGreaterThan(0);
  expect(less).toBe(little);
  expect(none).toBe(0);
  // Far under a good day's glow: it tells the cells apart, not the production.
  expect(little).toBeLessThan(much / 2);

  tint(group, [0.12, 0.02, 0, 0.8], { colour: 0xffa63a, daylight: 0 });
  expect(strength()).toEqual([0, 0, 0, 0]);
});

test("a click on a module tells its grid, its place in it and the point struck; beside it, the roof", () => {
  const group = buildScene(house, panels);
  const camera = new PerspectiveCamera(40, 1, 0.1, 500);

  for (const panel of panels) {
    const aim = within(panel, 0.5, 0.5);
    const middle = point(aim);

    camera.position.copy(middle).add(new Vector3(0, 20, 6));
    camera.lookAt(middle);
    camera.updateMatrixWorld();

    const hit = strike(group, panels, camera, [0, 0]);

    expect(hit).toMatchObject({ kind: "grid", grid: panel.grid ?? -1, module: panel.module ?? -1 });

    // On the module's face, a few centimetres proud of the roof.
    const struck = hit?.kind === "grid" ? hit.point : undefined;

    expect(struck?.map((metres, i) => Math.abs(metres - (aim[i] ?? 0)) < 0.1)).toEqual([
      true,
      true,
      true,
    ]);
  }

  camera.position.set(11.5, 30, 7);
  camera.lookAt(point(onRoof(11.5, -7)));
  camera.updateMatrixWorld();
  expect(strike(group, panels, camera, [0, 0])?.kind).toBe("point");
});
