/// <reference types="bun" />
import { expect, test } from "bun:test";
import { loadPv } from "@sunreye/pv-wasm";
import type { Opening, Scene } from "./pv.ts";
import { markerAt, openingAt, spotAt, type WallSpot } from "./wall-spot.ts";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

/** A 10 × 8 m block with 3 m walls; its front wall runs along the south, 8 m from its back. */
const house: Scene = {
  north: 0,
  blocks: [{ x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "flat" } }],
  obstacles: [],
};

const walls = (scene: Scene) => pv.modules(scene, {}).walls;

/** A spot on the front wall, `along` metres from its west end and `height` up. */
const front = (along: number, height: number): WallSpot => ({
  block: 0,
  wall: "front",
  along,
  height,
  at: [along, -8, height],
});

test("a point on a wall is a spot on it: the wall, the metres along from its left end, the height", () => {
  // East, north, up: 3 m from the west end of the south wall.
  expect(spotAt(walls(house), 0, [3, -8, 1.5])).toEqual(front(3, 1.5));
  // The east wall, seen from outside, starts at its south end.
  expect(spotAt(walls(house), 0, [10, -6, 2])).toMatchObject({ wall: "right", along: 2 });
  // The roof is no wall.
  expect(spotAt(walls(house), 0, [5, -4, 3])).toBeUndefined();
});

test("a window goes in with its middle at the spot, a door with its foot on the ground", () => {
  const glazed = openingAt(pv, house, front(3, 1.6), "window");

  expect("unfit" in glazed ? glazed : glazed.openings).toEqual([
    { kind: "window", block: 0, wall: "front", along: 2.4, width: 1.2, height: 1.4, sill: 0.9 },
  ]);

  const door = openingAt(pv, house, front(6, 2.5), "frontDoor");

  expect("unfit" in door ? door : door.openings?.[0]).toMatchObject({ along: 5.5, sill: 0 });
});

test("a spot by the wall's end or under its eave still takes the opening, kept on the wall", () => {
  const end = openingAt(pv, house, front(9.9, 1.6), "window");

  expect("unfit" in end ? end : end.openings?.[0]).toMatchObject({ along: 8.8, sill: 0.9 });

  // Its middle at 2.9 m would stand it through the eave: its usual sill instead.
  const high = openingAt(pv, house, front(3, 2.9), "window");

  expect("unfit" in high ? high : high.openings?.[0]).toMatchObject({ along: 2.4, sill: 0.9 });
});

test("a spot on another opening, or on a wall too short, takes none and says which", () => {
  const window: Opening = {
    kind: "window",
    block: 0,
    wall: "front",
    along: 2,
    width: 1.2,
    height: 1.4,
    sill: 0.9,
  };

  expect(openingAt(pv, { ...house, openings: [window] }, front(3, 1.6), "frontDoor")).toEqual({
    unfit: "overlap",
  });

  const shed: Scene = { ...house, blocks: [{ ...house.blocks[0]!, width: 2 }] };

  expect(openingAt(pv, shed, front(1, 1), "garageDoor")).toEqual({ unfit: "room" });
});

test("a marker hangs at the spot along the wall, naming the device", () => {
  const hung = markerAt(pv, house, front(3.14, 1.2), { kind: "battery", device: 4 });

  expect("unfit" in hung ? hung : hung.equipment).toEqual([
    { device: 4, kind: "battery", block: 0, wall: "front", along: 3.1, inside: false },
  ]);
});

test("a wall lower than a door still takes it, cut to the wall as the crate cuts any", () => {
  const low: Scene = { ...house, blocks: [{ ...house.blocks[0]!, eave: 2 }] };
  const door = openingAt(pv, low, front(5, 1), "frontDoor");

  expect("unfit" in door ? door : door.openings?.[0]).toMatchObject({
    along: 4.5,
    sill: 0,
    height: 2,
  });
});

test("each marker is judged on its own: past the wall's end it is refused, whatever the others are", () => {
  const battery = { kind: "battery", device: 4 } as const;

  const stray = {
    device: 4,
    kind: "inverter",
    block: 0,
    wall: "front",
    along: 30,
    inside: false,
  } as const;

  const strayed = { ...house, equipment: [stray] };
  const hung = markerAt(pv, strayed, front(3, 1.2), battery);

  expect(markerAt(pv, house, front(30, 1.2), battery)).toEqual({ unfit: "room" });
  expect("unfit" in hung ? hung : hung.equipment).toHaveLength(2);
  // Another off its wall excuses none.
  expect(markerAt(pv, strayed, front(30, 1.2), battery)).toEqual({ unfit: "room" });
});

test("a window that would lie over another at the finger's height is refused, not moved to its usual sill", () => {
  // A fanlight high on the wall: a window at 0.9 m would pass under it, one at the finger does not.
  const fanlight: Opening = {
    kind: "window",
    block: 0,
    wall: "front",
    along: 2.4,
    width: 1.2,
    height: 0.4,
    sill: 2.5,
  };

  expect(openingAt(pv, { ...house, openings: [fanlight] }, front(3, 2.1), "window")).toEqual({
    unfit: "overlap",
  });
});
