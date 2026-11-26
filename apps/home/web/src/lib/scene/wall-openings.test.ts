/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  type Object3D,
} from "three";
import type { Face, Fitted } from "@sunreye/pv-wasm";
import type { OpeningKind } from "@sunreye/scene";
import { lamps, openings } from "../../../../../../packages/builder/src/scene/wall-openings.ts";

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

function drawn(made: readonly Fitted[], roofs: readonly Face[] = []): Group {
  const group = new Group();

  group.add(...openings(made, roofs));

  return group;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function glow(mesh: Object3D): number {
  const glass = (mesh instanceof Mesh ? [mesh.material].flat() : []).find(
    (material) => material instanceof MeshPhysicalMaterial,
  );

  if (glass === undefined) throw new TypeError("no opening");

  return glass.emissiveIntensity;
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
  /** Its lowest and highest point, in metres up. */
  readonly bottom: number;
  readonly top: number;
  readonly strength: number;
}

/** The light an opening spills, when it spills any. */
function patch(opening: Fitted, roofs: readonly Face[] = []): Patch | undefined {
  const spill = drawn([opening], roofs).getObjectByName("spill");

  if (!(spill instanceof Mesh) || !(spill.geometry instanceof BufferGeometry)) return undefined;

  const colour: unknown = spill.geometry.getAttribute("color");
  const { min, max } = new Box3().setFromObject(spill);

  // East is x and the wall faces +z, at z 0.
  return {
    near: min.z,
    far: max.z,
    left: min.x,
    right: max.x,
    bottom: min.y,
    top: max.y,
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

/** A lower roof against the wall, wider than it: `up` metres high at the wall, `deep` metres out
 * from it, and `drop` metres lower at its far edge. */
function lowerRoof(up: number, deep: number, drop = 0): Face {
  return {
    surface: "roof",
    corners: [
      [-5, 0 - deep, up - drop],
      [100, 0 - deep, up - drop],
      [100, 0, up],
      [-5, 0, up],
    ],
  };
}

test("a window above a lower roof lights that roof, not the lawn", () => {
  // Its sill is 2.5 m above the lawn, yet only 0.3 m above the roof under it.
  const [lawn, roof] = [patch(litWindow(2.5)), patch(litWindow(2.5), [lowerRoof(2.2, 6)])];

  expect(lawn?.top).toBeLessThan(0.1);
  expect(roof?.bottom).toBeGreaterThan(2.2);
  expect(roof?.top).toBeLessThan(2.3);
  // A low sill throws its light close by and bright.
  expect(roof?.near).toBeLessThan(0.5);
  expect(roof?.strength).toBeGreaterThan(lawn?.strength ?? 1);
});

test("a window higher than a storey above the lawn still lights a roof just under it", () => {
  expect(patch(litWindow(3.6), [lowerRoof(3.2, 6)])?.bottom).toBeGreaterThan(3.2);
});

test("its light ends where that roof does, and none falls past it onto the lawn", () => {
  const thrown = patch(litWindow(2.5), [lowerRoof(2.2, 1)]);

  expect(thrown?.far).toBeCloseTo(1);
  expect(thrown?.bottom).toBeGreaterThan(2.2);
  // The light of a window 1.2 m above the roof would land past its edge.
  expect(patch(litWindow(3.4), [lowerRoof(2.2, 0.5)])).toBeUndefined();
});

test("on a pitched roof the light lies on the slope", () => {
  // The roof falls 1 m over its 4 m.
  const thrown = patch(litWindow(2.5), [lowerRoof(2.2, 4, 1)]);

  if (thrown === undefined) throw new Error("no spill");

  expect(thrown.top).toBeCloseTo(2.2 - thrown.near / 4 + 0.04, 2);
  expect(thrown.bottom).toBeCloseTo(2.2 - thrown.far / 4 + 0.04, 2);
});

test("a roof above the window, such as its own eave, takes none of its light", () => {
  expect(patch(litWindow(0.9), [lowerRoof(3, 1)])?.top).toBeLessThan(0.1);
});

/** Which of `made` glow at night with the night light `light` chosen for each. */
const chosen = (light: "on" | "off", made: readonly Fitted[] = street) =>
  glowing(drawnAtNight(made.map((item) => ({ ...item, light }))));

test("a chosen night light overrules the rule: lit every night, or never", () => {
  expect(chosen("on").every(Boolean)).toBe(true);
  expect(chosen("off").some(Boolean)).toBe(false);
  // A front door's light is on by the rule; chosen dark, it stays dark.
  expect(chosen("off", [fitted("frontDoor", 0)])).toEqual([false]);
});
