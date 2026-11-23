/// <reference types="bun" />
import { expect, test } from "bun:test";
import { Color, LineBasicMaterial, LineLoop } from "three";
import { overlay } from "../../../../../packages/builder/src/builder/overlay.ts";
import type { Footprint, Point } from "../../../../../packages/builder/src/builder/pv.ts";

// Modules selected on a face are each outlined in the brand colour over the roof (ADR 20).

const brand = new Color(0x00ff00);

const tints = { brand, unfit: new Color(0xff0000) };

/** A module 1 m square with its lower left corner at `east`, on a level roof at 3 m. */
function module(east: number): Footprint {
  const corners: Point[] = [
    [east, 0, 3],
    [east + 1, 0, 3],
    [east + 1, 1, 3],
    [east, 1, 3],
  ];

  return {
    area: [
      [east, 0],
      [east + 1, 1],
    ],
    corners,
  };
}

const shade = {
  modules: [module(0), module(2), module(4)],
  outline: [
    [-1, -1, 3],
    [7, -1, 3],
    [7, 2, 3],
    [-1, 2, 3],
  ] as const satisfies readonly Point[],
  inset: null,
  blocked: [],
};

/** How many outlines the overlay draws in the brand colour. */
function outlined(selected: readonly Footprint[]): number {
  let loops = 0;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's part, read only.
  overlay({ kind: "modules", shade, selected }, tints).traverse((part) => {
    const material: unknown = part instanceof LineLoop ? part.material : undefined;

    if (material instanceof LineBasicMaterial && material.color.equals(brand)) loops += 1;
  });

  return loops;
}

test("every selected module is outlined; none selected, none", () => {
  expect(outlined([module(0), module(4)])).toBe(2);
  expect(outlined([module(2)])).toBe(1);
  expect(outlined([])).toBe(0);
});
