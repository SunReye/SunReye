/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import type { Fitted, OpeningKind } from "../builder/pv.ts";
import { lamps, openings } from "./wall-openings.ts";

/** An opening on a wall facing south at north 0, `east` metres along it; a window's sill is
 * `sill` metres up. */
function fitted(kind: OpeningKind, east: number, sill = 0.9): Fitted {
  const [low, high] = kind === "window" ? [sill, sill + 1.4] : [0, 2.1];

  return {
    kind,
    corners: [
      [east, 0, low],
      [east + 1.2, 0, low],
      [east + 1.2, 0, high],
      [east, 0, high],
    ],
    out: [0, -1, 0],
  };
}

const street = Array.from({ length: 12 }, (_, i) => fitted("window", i * 2));

function drawn(made: readonly Fitted[]): Group {
  const group = new Group();

  group.add(...openings(made));

  return group;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function glow(mesh: Object3D): number {
  if (!(mesh instanceof Mesh) || !(mesh.material instanceof MeshStandardMaterial)) {
    throw new TypeError("no opening");
  }

  return mesh.material.emissiveIntensity;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
const glowing = (group: Group): boolean[] =>
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  group.getObjectsByProperty("name", "opening").map((mesh) => glow(mesh) > 0);

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function brightest(group: Group): number {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  return Math.max(...group.getObjectsByProperty("name", "opening").map((mesh) => glow(mesh)));
}

test("an opening is drawn on its wall, a little proud of it, with its sill", () => {
  const [window] = drawn([fitted("window", 2)]).getObjectsByProperty("name", "opening");
  const box = new Box3().setFromObject(window ?? new Group());

  // East is x, up is y, south is z: the wall faces +z.
  expect(box.min.x).toBeLessThanOrEqual(2);
  expect(box.max.x).toBeGreaterThanOrEqual(3.2);
  expect(box.max.y).toBeCloseTo(2.3);
  expect(box.min.y).toBeLessThan(0.9);
  expect(box.min.y).toBeGreaterThan(0.8);
  expect(box.min.z).toBeGreaterThanOrEqual(0);
  expect(box.max.z).toBeLessThan(0.2);
});

test("at night some windows glow, the same ones every time; by day none do", () => {
  const [first, second] = [drawn(street), drawn(street)];

  lamps(first, 1);
  lamps(second, 1);

  const lit = glowing(first).filter(Boolean).length;

  expect(lit).toBeGreaterThan(2);
  expect(lit).toBeLessThan(street.length);
  expect(glowing(second)).toEqual(glowing(first));

  lamps(first, 0);

  expect(glowing(first)).toEqual(street.map(() => false));
});

test("across dusk the windows come on by degrees", () => {
  const group = drawn(street);

  lamps(group, 0.5);

  const half = brightest(group);

  lamps(group, 1);

  expect(half).toBeGreaterThan(0);
  expect(half).toBeLessThan(brightest(group));
});

test("a front door's light comes on at night; a garage door stays dark", () => {
  const group = drawn([fitted("frontDoor", 0), fitted("garageDoor", 4)]);

  lamps(group, 1);

  expect(glowing(group)).toEqual([true, false]);
});

test("light spills on the ground under each lit opening, in one draw, and only at night", () => {
  const group = drawn(street);
  const spill = group.getObjectByName("spill");

  if (
    !(spill instanceof Mesh) ||
    !(spill.geometry instanceof BufferGeometry) ||
    !(spill.material instanceof MeshBasicMaterial)
  ) {
    throw new TypeError("no spill");
  }

  lamps(group, 1);

  const position: unknown = spill.geometry.getAttribute("position");

  expect(position instanceof BufferAttribute ? position.count : 0).toBe(
    glowing(group).filter(Boolean).length * 6,
  );
  expect(spill.material.opacity).toBeGreaterThan(0);
  expect(spill.visible).toBe(true);

  lamps(group, 0);

  expect(spill.visible).toBe(false);
  expect(drawn([fitted("garageDoor", 0)]).getObjectByName("spill")).toBeUndefined();
});

/** A patch of spilt light: from `near` to `far` out from the wall, from `left` to `right` east,
 * in metres, and how bright it is, 0 to 1. */
interface Patch {
  readonly near: number;
  readonly far: number;
  readonly left: number;
  readonly right: number;
  readonly strength: number;
}

/** The light an opening spills, when it spills any. */
function patch(opening: Fitted): Patch | undefined {
  const spill = drawn([opening]).getObjectByName("spill");

  if (!(spill instanceof Mesh) || !(spill.geometry instanceof BufferGeometry)) return undefined;

  const colour: unknown = spill.geometry.getAttribute("color");
  const { min, max } = new Box3().setFromObject(spill);

  // East is x and the wall faces +z, at z 0.
  return {
    near: min.z,
    far: max.z,
    left: min.x,
    right: max.x,
    strength: colour instanceof BufferAttribute ? colour.getX(0) : Number.NaN,
  };
}

/** A lit window with its sill `sill` metres up: the first along the wall that is lit. */
function litWindow(sill: number): Fitted {
  const found = Array.from({ length: 40 }, (_, i) => fitted("window", i * 2, sill)).find(
    (window) => glowing(drawnAtNight([window]))[0] === true,
  );

  if (found === undefined) throw new Error("no lit window");

  return found;
}

function drawnAtNight(made: readonly Fitted[]): Group {
  const group = drawn(made);

  lamps(group, 1);

  return group;
}

test("a window's light lands out from the wall, never at its foot", () => {
  const thrown = patch(litWindow(0.9));

  // Light through a window 0.9 m up reaches the ground well clear of the wall.
  expect(thrown?.near).toBeGreaterThan(0.5);
  expect(thrown?.far).toBeGreaterThan(2);
});

test("a higher window throws a fainter, wider patch further out", () => {
  const [low, high] = [patch(litWindow(0.5)), patch(litWindow(1.6))];

  if (low === undefined || high === undefined) throw new Error("no spill");

  expect(high.near).toBeGreaterThan(low.near);
  expect(high.far).toBeGreaterThan(low.far);
  expect(high.right - high.left).toBeGreaterThan(low.right - low.left);
  expect(high.far - high.near).toBeGreaterThan(low.far - low.near);
  expect(high.strength).toBeLessThan(low.strength);
  expect(high.strength).toBeGreaterThan(0);
  expect(low.strength).toBeLessThanOrEqual(1);
});

test("an upper-storey window spills no light on the ground", () => {
  expect(patch(litWindow(3.6))).toBeUndefined();
});

test("a front door's light lies in front of the door, nearer than a window's", () => {
  const door = patch(fitted("frontDoor", 4));
  const window = patch(litWindow(0.9));

  // The door runs from 4 m to 5.2 m east.
  expect(door?.left).toBeLessThan(4);
  expect(door?.right).toBeGreaterThan(5.2);
  expect(door?.near).toBeGreaterThan(0);
  expect(door?.near).toBeLessThan(window?.near ?? 0);
  expect(door?.strength).toBe(1);
});
