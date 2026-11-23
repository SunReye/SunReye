/// <reference types="bun" />
import { expect, test } from "bun:test";
import { loadPv } from "@sunreye/pv-wasm";
import type { Opening, Scene } from "../../../../../packages/builder/src/builder/pv.ts";
import {
  duplicate,
  pasted,
  fresh,
  refit,
  slide as slideOn,
  withOpenings,
  type OpeningGrip,
} from "../../../../../packages/builder/src/builder/wall-openings.ts";

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

/** A 10 × 8 m block with 3 m walls. */
const house: Scene = {
  north: 0,
  blocks: [{ x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "flat" } }],
  obstacles: [],
};

const window: Opening = {
  kind: "window",
  block: 0,
  wall: "front",
  along: 2,
  width: 1.2,
  height: 1.4,
  sill: 0.9,
};

const glazed = (...openings: readonly Opening[]): Scene => ({ ...house, openings });

/** A ray straight at the front wall (z = 8) from the south, in three.js's frame. */
const ray = (x: number, y = 1.5) => ({ origin: [x, y, 20], direction: [0, 0, -1] }) as const;

type Aimed = ReturnType<typeof ray>;

/** A drag of the scene's first opening, on the walls the crate lays out for it. */
const slide = (scene: Scene, grip: OpeningGrip, grab: Aimed, now: Aimed) =>
  slideOn(scene, 0, grip, [grab, now], { pv, laid: pv.modules(scene, {}) });

test("a new opening takes the first free place on a wall, in its kind's usual size", () => {
  const first = fresh(pv, house, "window");
  const second = first && fresh(pv, glazed(first), "frontDoor");

  expect(first).toEqual({
    kind: "window",
    block: 0,
    wall: "front",
    along: 0.5,
    width: 1.2,
    height: 1.4,
    sill: 0.9,
  });
  // Past the window, a hand's breadth on.
  expect(second).toMatchObject({
    kind: "frontDoor",
    wall: "front",
    sill: 0,
    width: 1,
    height: 2.1,
  });
  expect(second?.along).toBeGreaterThanOrEqual(1.7);
});

test("a scene without a walled block takes no opening, and a low wall a lower one", () => {
  const carport: Scene = {
    ...house,
    blocks: house.blocks.map((block) => ({ ...block, open: true })),
  };

  const shed: Scene = { ...house, blocks: house.blocks.map((block) => ({ ...block, eave: 1.8 })) };

  expect(fresh(pv, carport, "window")).toBeNull();
  expect(fresh(pv, shed, "frontDoor")).toMatchObject({ height: 1.8 });
});

test("a change is kept on its wall and under the eave, and refused over another opening", () => {
  const scene = glazed(window, { ...window, along: 5 });

  const moved = (change: Partial<Opening>) => {
    const fitted = refit(pv, scene, 0, change);

    return "unfit" in fitted ? fitted.unfit : fitted.openings?.[0];
  };

  expect(moved({ along: 9.5 })).toMatchObject({ along: 8.8 });
  expect(moved({ along: -1 })).toMatchObject({ along: 0 });
  expect(moved({ height: 5 })).toMatchObject({ height: 2.1 });
  // The wall is 10 m long.
  expect(moved({ width: 30 })).toBe("room");
  // 4 m + 1.2 m overlaps the window at 5 m.
  expect(moved({ along: 4 })).toBe("overlap");
  // A door stands on the ground.
  expect(moved({ kind: "frontDoor" })).toMatchObject({ sill: 0 });
});

test("dragging an opening slides it along its wall in 10 cm steps", () => {
  const scene = glazed(window);
  // 0.57 m to the right.
  const dragged = slide(scene, "move", ray(2.5), ray(3.07));

  expect(dragged?.scene.openings?.[0]).toMatchObject({ along: 2.6, width: 1.2 });
  expect(dragged).toMatchObject({ value: [2.6, 0.9], unit: "m" });
});

test("dragging a window also moves it up and down its wall, its sill following in 10 cm steps", () => {
  const up = slide(glazed(window), "move", ray(2.5, 1.5), ray(3.52, 1.93));

  expect(up?.scene.openings?.[0]).toEqual({ ...window, along: 3, sill: 1.3 });
  expect(up?.value).toEqual([3, 1.3]);

  // Kept whole under the 3 m eave and off the ground's far side.
  expect(slide(glazed(window), "move", ray(2.5, 1.5), ray(2.5, 9))?.scene.openings?.[0]).toEqual({
    ...window,
    sill: 1.6,
  });
  expect(slide(glazed(window), "move", ray(2.5, 1.5), ray(2.5, -9))?.scene.openings?.[0]).toEqual({
    ...window,
    sill: 0,
  });
});

test("a door dragged up stays on the ground", () => {
  const door: Opening = { ...window, kind: "frontDoor", height: 2.1, sill: 0 };
  const moved = slide(glazed(door), "move", ray(2.5, 1.5), ray(3.5, 2.5));

  expect(moved?.scene.openings?.[0]).toEqual({ ...door, along: 3 });
  expect(moved?.value).toEqual([3]);
});

test("its width and height handles resize it, kept on the wall and under the eave", () => {
  const scene = glazed(window);

  expect(slide(scene, "width", ray(3.2, 1.5), ray(3.68, 1.5))?.scene.openings?.[0]).toMatchObject({
    width: 1.7,
    along: 2,
  });
  expect(slide(scene, "height", ray(2.5, 2.3), ray(2.5, 2.52))?.scene.openings?.[0]).toMatchObject({
    height: 1.6,
  });
  // The eave is at 3 m: 0.9 m of sill leaves 2.1 m.
  expect(slide(scene, "height", ray(2.5, 2.3), ray(2.5, 9))?.scene.openings?.[0]).toMatchObject({
    height: 2.1,
  });
});

test("a drag onto another opening stays where it was", () => {
  const scene = glazed(window, { ...window, along: 4 });

  expect(slide(scene, "move", ray(2.5), ray(3.5))).toBeNull();
});

test("a removed block takes its openings with it, and later blocks' follow it down", () => {
  const two: Scene = {
    ...house,
    blocks: [...house.blocks, ...house.blocks],
    openings: [window, { ...window, block: 1 }],
  };

  expect(withOpenings(two, 0).openings).toEqual([{ ...window, block: 0 }]);
  expect(withOpenings(house, 0)).toEqual(house);
});

test("a duplicate stands to the right of its original on the same wall, like it in all but place", () => {
  const dark = { ...window, light: "off" } as const;
  const copied = duplicate(pv, glazed(dark), 0);

  // The 1.2 m window ends at 3.2 m; its copy starts 20 cm on.
  expect(copied?.openings).toEqual([dark, { ...dark, along: 3.4 }]);
});

test("without room to its right a duplicate takes the wall's first free place, or none", () => {
  const last = { ...window, along: 8.6 };

  expect(duplicate(pv, glazed(last), 0)?.openings?.[1]).toEqual({ ...last, along: 0 });

  const whole = { ...window, along: 0, width: 10 };

  expect(duplicate(pv, glazed(whole), 0)).toBeNull();
});

test("a copied opening is pasted beside where it stood, whatever became of it since", () => {
  // The original has moved off: its copy still stands beside where it was copied.
  const moved = { ...window, along: 0 };

  expect(pasted(pv, glazed(moved), window)?.openings).toEqual([moved, { ...window, along: 3.4 }]);
  // Its block is gone: nothing is pasted.
  expect(pasted(pv, glazed(window), { ...window, block: 7 })).toBeNull();
});
