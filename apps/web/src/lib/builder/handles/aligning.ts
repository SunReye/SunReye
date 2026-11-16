// Lining imported surroundings up with the blocks (ADR 20): a knob on their centre moves them, a
// ring turns them, and a tap hides or shows one of their buildings. Pure.
import type { Imported } from "../imported.ts";
import type { Scene } from "../pv.ts";
import { snap, tidy, toDegrees, turn, world, type Triple } from "./frame.ts";
import type { Dragged, Grab } from "./dragging.ts";
import type { Handle } from "./grips.ts";

/** Metres from the blocks' farthest corner to the ring, and the ring's least radius. */
const CLEAR = 2;
const LEAST = 8;

const LENGTH = 0.1;
const ANGLE = 5;

/** A turn this close, in degrees, to one that lines a building up with a block snaps to it. */
const ALIGN = 3;

/** How far the blocks reach from scene point `x`, `z`. */
function reach({ blocks }: Scene, x: number, z: number): number {
  const corners = blocks.flatMap((block) =>
    [
      [0, 0],
      [block.width, 0],
      [block.width, block.depth],
      [0, block.depth],
    ].map(([u = 0, w = 0]: readonly number[]) => {
      const [dx, dz] = turn(u, w, block.rotation);

      return Math.hypot(block.x + dx - x, block.z + dz - z);
    }),
  );

  return Math.max(0, ...corners);
}

/** The knob on the surroundings' centre and the ring round the blocks; none without an import. */
export function importHandles(scene: Scene): Handle[] {
  const imported = scene.imported;

  if (imported === undefined || imported === null) return [];

  const at = world(scene.north, [imported.x, 0, imported.z]);

  return [
    { grip: "point", at },
    { grip: "turn", at, radius: Math.max(LEAST, reach(scene, imported.x, imported.z) + CLEAR) },
  ];
}

/**
 * The turns, in degrees from 0 to under 90, at which a hidden building's longest side runs along
 * a block's walls: the buildings under the blocks are the ones hidden.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the core's document, read only.
export function rests(scene: Scene, document: Imported): number[] {
  const hidden = new Set(scene.imported?.hidden);

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the core's document, read only.
  return document.buildings.flatMap(({ id, outline }) => {
    if (!hidden.has(id)) return [];

    let longest = { length: 0, bearing: 0 };

    for (const [i, [bx = 0, by = 0]] of outline.entries()) {
      const [ax = 0, ay = 0] = outline.at(i - 1) ?? [];
      const length = Math.hypot(bx - ax, by - ay);

      // Counter-clockwise from east, as the document counts north.
      if (length > longest.length)
        longest = { length, bearing: toDegrees(Math.atan2(by - ay, bx - ax)) };
    }

    return scene.blocks.map(
      (block) => (((longest.bearing + block.rotation + scene.north) % 90) + 90) % 90,
    );
  });
}

/** A turn snapped to one of `lined` within 3°, else to 5°. */
function snapTurn(wanted: number, lined: readonly number[]): number {
  for (const rest of lined) {
    const off = ((((wanted - rest) % 90) + 135) % 90) - 45;

    if (Math.abs(off) <= ALIGN) return wanted - off;
  }

  return snap(wanted, ANGLE);
}

const normalised = (angle: number): number => tidy(((angle % 360) + 360) % 360);

/** What dragging the surroundings' knob or ring from `from` to `to`, in the scene's frame, makes
 * of the scene; `lined` are the turns the ring snaps to. */
export function align(
  scene: Scene,
  { grip }: Pick<Grab, "grip">,
  [from, to]: readonly [Triple, Triple],
  lined: readonly number[] = [],
): Dragged | null {
  const imported = scene.imported;

  if (imported === undefined || imported === null) return null;

  if (grip === "point") {
    const x = snap(imported.x + to[0] - from[0], LENGTH);
    const z = snap(imported.z + to[2] - from[2], LENGTH);

    return { scene: { ...scene, imported: { ...imported, x, z } }, value: [x, z], unit: "m" };
  }

  if (grip !== "turn") return null;

  const bearing = (point: Triple): number =>
    toDegrees(Math.atan2(point[2] - imported.z, point[0] - imported.x));

  const wanted = imported.turn + bearing(to) - bearing(from);
  const turned = normalised(snapTurn(wanted, lined));

  return {
    scene: { ...scene, imported: { ...imported, turn: turned } },
    value: [turned],
    unit: "°",
  };
}

/** The scene with imported building `id` hidden if it was shown, shown if it was hidden. */
export function toggled(scene: Scene, id: number): Scene {
  const imported = scene.imported;

  if (imported === undefined || imported === null) return scene;

  const hidden = imported.hidden ?? [];

  return {
    ...scene,
    imported: {
      ...imported,
      hidden: hidden.includes(id) ? hidden.filter((other) => other !== id) : [...hidden, id],
    },
  };
}
