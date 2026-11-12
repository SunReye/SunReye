// Templates: the starting scenes an empty scene offers (ADR 20). Nothing remembers which one filled
// it; the admin then edits as usual.
import type { Draft } from "./modules.ts";
import type { Block } from "./pv.ts";

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

/** `draft` with the template's blocks; its compass, surroundings and strings stay. */
export function fill(draft: Draft, template: Template): Draft {
  return { ...draft, scene: { ...draft.scene, blocks: blocksOf(template, draft.scene.north) } };
}
