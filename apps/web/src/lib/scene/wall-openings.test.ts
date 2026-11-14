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

/** An opening on a wall facing south at north 0, `east` metres along it. */
function fitted(kind: OpeningKind, east: number): Fitted {
  const [low, high] = kind === "window" ? [0.9, 2.3] : [0, 2.1];

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
