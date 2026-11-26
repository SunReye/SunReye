/// <reference types="bun" />
import { expect, test } from "bun:test";
import { addLine, pullEaves, type Edited, type End, type Scene, type Spot } from "@sunreye/scene";
import { pick } from "../../../../../../packages/builder/src/builder/trace-pick.ts";

// Picking a traced roof by its pixels (ADR 20): a raised point is drawn away from the ground under
// it, so a click is matched to the roof as drawn.

function made(edited: Edited): Scene {
  if ("refused" in edited) throw new Error(edited.refused);

  return edited.scene;
}

/** A 4 m square traced on the ground from (0, 0), its eaves pulled to 5 m. */
function square(): Scene {
  let scene: Scene = { north: 0, blocks: [], obstacles: [] };
  let from: End = { x: 0, z: 0 };

  for (const [x, z] of [
    [0, 4],
    [4, 4],
    [4, 0],
    [0, 0],
  ] as const) {
    const edited = addLine(scene, from, { x, z }, 0.3);

    scene = made(edited);
    from = "refused" in edited ? from : { block: edited.block, point: edited.to };
  }

  return made(pullEaves(scene, 0, 5));
}

const raised = square();

/** Seen from above at 10 m over the origin: 50 pixels a metre on the ground, more up high. */
const onscreen = ([x, y, z]: Spot): readonly [number, number] => {
  const scale = 500 / (10 - y);

  return [x * scale, z * scale];
};

test("a click on a raised corner picks it, not the ground under the pixel", () => {
  // The corner (4, 5, 4) is drawn at 400 px; the ground there is (8, 0, 8), on no line.
  const picked = pick(raised, onscreen, [400, 400], 12);

  expect(picked?.kind).toBe("point");
  expect(picked?.at).toEqual([4, 5, 4]);
});

test("a click on a raised line picks the place on it as drawn, its height with it", () => {
  // The eave from (4, 5, 0) to (4, 5, 4) is drawn at x = 400 px; halfway is 200 px down.
  const picked = pick(raised, onscreen, [403, 200], 12);

  expect(picked?.kind).toBe("line");
  expect(picked?.at).toEqual([4, 5, 2]);
});

test("a click off every drawn point and line picks nothing", () => {
  expect(pick(raised, onscreen, [200, 200], 12)).toBeUndefined();
});
