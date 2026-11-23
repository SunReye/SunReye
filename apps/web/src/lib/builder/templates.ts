// Templates: the starting scenes an empty scene offers (ADR 20). Nothing remembers which one filled
// it; the admin then edits as usual.
import type { Draft } from "@sunreye/builder/builder/modules.ts";
import type { Block, Opening } from "@sunreye/builder/builder/pv.ts";
import { USUAL } from "@sunreye/builder/builder/wall-openings.ts";

export const TEMPLATES = ["gable", "bungalow", "hip", "lHouse", "terraceEnd", "empty"] as const;

export type Template = (typeof TEMPLATES)[number];

const block = (
  width: number,
  depth: number,
  eave: number,
  roof: Block["roof"],
  at: Partial<Pick<Block, "x" | "z" | "rotation">> = {},
): Block => ({ x: 0, z: 0, rotation: 0, width, depth, eave, roof, ...at });

// Common German sizes in metres and degrees, the front (+z) facing south with the compass at 0°.
const BLOCKS: Readonly<Record<Template, readonly Block[]>> = {
  gable: [block(10, 8, 3, { kind: "gable", pitch: 35 })],
  bungalow: [block(12, 10, 3, { kind: "flat" })],
  hip: [block(11, 9, 5.5, { kind: "hip", pitch: 25 })],
  // The wing runs south from the main block's east end, its roof facing east and west.
  lHouse: [
    block(11, 8, 5.5, { kind: "gable", pitch: 35 }),
    block(6, 6, 5.5, { kind: "gable", pitch: 35 }, { x: 11, z: 8, rotation: 90 }),
  ],
  // The neighbour shares its west wall, so its shade is in the scene.
  terraceEnd: [
    block(6, 10, 6, { kind: "gable", pitch: 40 }),
    block(6, 10, 6, { kind: "gable", pitch: 40 }, { x: -6 }),
  ],
  empty: [],
};

/** The template's blocks, turned about the origin so their front faces the compass's south. */
export function blocksOf(template: Template, north: number): Block[] {
  const [sin, cos] = [Math.sin((-north * Math.PI) / 180), Math.cos((-north * Math.PI) / 180)];

  // Clockwise seen from above, as the crate turns a block.
  const turned = (one: Block): Block => ({
    ...one,
    x: one.x * cos - one.z * sin,
    z: one.x * sin + one.z * cos,
    rotation: (((one.rotation - north) % 360) + 360) % 360,
  });

  return BLOCKS[template].map(turned);
}

const fitted = (kind: Opening["kind"], wall: Opening["wall"], along: number, on = 0): Opening => ({
  kind,
  block: on,
  wall,
  along,
  ...USUAL[kind],
});

/** A front door between two windows on the first block's front, a French window to the garden
 * at the back and a window in each side wall: a house that reads as lived in from the start. */
const HOUSE: readonly Opening[] = [
  fitted("window", "front", 1),
  fitted("frontDoor", "front", 4),
  fitted("window", "front", 6.5),
  fitted("frenchWindow", "back", 2),
  fitted("window", "left", 2.5),
  fitted("window", "right", 2.5),
];

const OPENINGS: Readonly<Record<Template, readonly Opening[]>> = {
  gable: HOUSE,
  bungalow: HOUSE,
  hip: HOUSE,
  // The wing's own wall carries a window.
  lHouse: [...HOUSE.filter(({ wall }) => wall !== "right"), fitted("window", "right", 2, 1)],
  // The shared wall has none; nor has the neighbour.
  terraceEnd: [
    fitted("frontDoor", "front", 0.8),
    fitted("window", "front", 3),
    fitted("frenchWindow", "back", 2),
    fitted("window", "right", 4),
  ],
  empty: [],
};

/** `draft` with the template's blocks and their windows and doors; its compass, surroundings and
 * strings stay. */
export function fill(draft: Draft, template: Template): Draft {
  const { openings: _, ...scene } = draft.scene;
  const openings = OPENINGS[template];

  return {
    ...draft,
    scene: {
      ...scene,
      blocks: blocksOf(template, scene.north),
      ...(openings.length > 0 && { openings }),
    },
  };
}
