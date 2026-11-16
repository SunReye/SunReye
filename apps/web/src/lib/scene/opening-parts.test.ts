/// <reference types="bun" />
import { expect, test } from "bun:test";
import { BufferAttribute, BufferGeometry, Group, Mesh, type Object3D } from "three";
import type { Fitted, OpeningKind } from "../builder/pv.ts";
import { openings } from "./wall-openings.ts";

// What a window and a door are made of (ADR 20 Openings, Look): plain shapes, no maps.

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

function drawn(made: readonly Fitted[]): Group {
  const group = new Group();

  group.add(...openings(made, []));

  return group;
}

/** The triangles a mesh draws in each of its materials: a frame, glass and a door's leaf. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function parts(mesh: Object3D | undefined): number[] {
  const groups =
    mesh instanceof Mesh && mesh.geometry instanceof BufferGeometry ? mesh.geometry.groups : [];

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  return groups.map(({ count }) => count / 3);
}

test("a window is a frame round two panes of glass; a front door a leaf under a fanlight; a garage door a leaf", () => {
  const [window, door, garage] = drawn([
    fitted("window", 0),
    fitted("frontDoor", 4),
    fitted("garageDoor", 8),
  ]).getObjectsByProperty("name", "opening");

  // Ten triangles a bar of the frame, a sill or a canopy; two a sheet of glass or a leaf.
  expect(parts(window)).toEqual([60, 2, 0]);
  expect(parts(door)).toEqual([60, 2, 2]);
  expect(parts(garage)).toEqual([40, 0, 2]);
});

test("glass and leaves lie inset in their frames, which stand 5 cm proud of the wall", () => {
  const [window] = drawn([fitted("window", 2)]).getObjectsByProperty("name", "opening");

  if (!(window instanceof Mesh) || !(window.geometry instanceof BufferGeometry)) {
    throw new TypeError("no window");
  }

  const position: unknown = window.geometry.getAttribute("position");
  const [frame, glass] = window.geometry.groups;

  if (!(position instanceof BufferAttribute) || frame === undefined || glass === undefined) {
    throw new TypeError("no parts");
  }

  // South is z: how far out from the wall each part reaches.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  const out = ({ start, count }: { start: number; count: number }): number =>
    Math.max(...Array.from({ length: count }, (_, i) => position.getZ(start + i)));

  // The sill reaches further than the frame.
  expect(out(frame)).toBeCloseTo(0.12);
  expect(out(glass)).toBeGreaterThan(0);
  expect(out(glass)).toBeLessThan(0.05);
});
