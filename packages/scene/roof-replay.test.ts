// Every tracing edit named (ADR 20): a consumer keeping the scene elsewhere replays each edit the
// tracing reports and makes the same next scene.

import { expect, test } from "bun:test";
import { dormers, lineKind, replay, type Scene, type TraceEdit } from "./index.js";
import { EMPTY } from "./roof.harness.ts";
import { built, height, line, placed, point } from "./roof-ready.harness.ts";

/** The scene each edit in turn makes; it fails the test when one is refused. */
function replayed(scene: Scene, ...edits: readonly TraceEdit[]): Scene {
  return edits.reduce((at, edit) => {
    const next = replay(at, edit);

    if ("refused" in next) throw new Error(`${edit.kind} refused: ${next.refused}`);

    return next.scene;
  }, scene);
}

const SIZE = { width: 10, depth: 8, eave: 3, ridge: 7 };

test("a Satteldach traced, marked and pulled by named edits is the ready one", () => {
  const outline = replayed(
    EMPTY,
    { kind: "add", from: { x: 0, z: 0 }, to: { x: 10, z: 0 }, reach: 0.3 },
    { kind: "add", from: { block: 0, point: 1 }, to: { x: 10, z: 8 }, reach: 0.3 },
    { kind: "add", from: { block: 0, point: 2 }, to: { x: 0, z: 8 }, reach: 0.3 },
    { kind: "add", from: { block: 0, point: 3 }, to: { block: 0, point: 0 }, reach: 0.3 },
    { kind: "add", from: { x: 0, z: 4 }, to: { x: 10, z: 4 }, reach: 0.3 },
  );

  const pulled = replayed(
    outline,
    { kind: "pull", block: 0, which: "eave", height: 3 },
    { kind: "pull", block: 0, which: "ridge", height: 7 },
  );

  expect(built(pulled)).toEqual(built(placed("satteldach")));
});

test("a ready roof, a ready dormer and the dormer's pull replay as named", () => {
  const house = replayed(EMPTY, { kind: "roof", id: "satteldach", at: { x: 0, z: 0 }, size: SIZE });

  const front = dormers(
    replayed(house, {
      kind: "dormer",
      block: 0,
      face: 0,
      id: "schleppgaube",
      at: { x: 5, z: 2 },
      size: { width: 2, depth: 2 },
    }),
    0,
  );

  expect(built(house)).toEqual(built(placed("satteldach")));
  expect(front).toHaveLength(1);

  const dormer = replayed(
    house,
    {
      kind: "dormer",
      block: 0,
      face: 0,
      id: "schleppgaube",
      at: { x: 5, z: 2 },
      size: { width: 2, depth: 2 },
    },
    { kind: "pullDormer", block: 0, face: front[0]?.faces[0] ?? -1, which: "eave", height: 4.5 },
  );

  expect(height(dormer, 4, 1)).toBe(4.5);
});

test("a line marked, a point set, a line moved and one removed replay as named", () => {
  const house = placed("satteldach");
  const front = line(house, [0, 0], [10, 0]);
  const marked = replayed(house, { kind: "mark", block: 0, line: front, as: "ridge" });

  expect(lineKind(marked, 0, front)).toBe("ridge");

  const set = replayed(house, { kind: "height", block: 0, point: point(house, 0, 4), height: 6 });

  expect(height(set, 0, 4)).toBe(6);

  const ridge = line(house, [0, 4], [10, 4]);
  const moved = replayed(house, { kind: "move", block: 0, line: ridge, by: { x: 0, z: 1 } });

  expect(height(moved, 10, 5)).toBe(7);

  const removed = replayed(house, { kind: "remove", block: 0, line: ridge });

  expect(removed.blocks[0]?.freeForm?.faces).toHaveLength(1);
});

test("a line added into a new roof is replayed into its own block beside the one it touches", () => {
  const house = replayed(EMPTY, {
    kind: "add",
    from: { x: 0, z: 0 },
    to: { x: 0, z: 4 },
    reach: 0.3,
  });

  const garage = replayed(house, {
    kind: "add",
    from: { block: 0, point: 1 },
    to: { x: 4, z: 4 },
    reach: 0.3,
    into: "new",
  });

  expect(garage.blocks).toHaveLength(2);
  expect(garage.blocks[1]?.freeForm?.traced?.points).toEqual([
    [0, 0, 4],
    [4, 0, 4],
  ]);
});

test("an outline left open is taken out whole, the roofs after it moving up", () => {
  const open = replayed(EMPTY, {
    kind: "add",
    from: { x: 0, z: 0 },
    to: { x: 0, z: 4 },
    reach: 0.3,
  });

  const second = replayed(open, {
    kind: "add",
    from: { x: 10, z: 0 },
    to: { x: 10, z: 4 },
    reach: 0.3,
    into: "new",
  });

  const left = replayed(second, { kind: "removeBlock", block: 0 });

  expect(left.blocks).toHaveLength(1);
  expect(left.blocks[0]?.freeForm?.traced?.points[0]).toEqual([10, 0, 0]);
});
