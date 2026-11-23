import { expect, test } from "vitest";
import { connect } from "../../api/core.ts";
import { DEVICES, house, MODULE, pv, testCore } from "../builder.harness.ts";
import { Session } from "@sunreye/builder/builder/session.svelte.ts";

function session(): Session {
  let made: Session | undefined;
  const start = house();

  $effect.root(() => {
    made = new Session(() => ({
      pv,
      core: connect(testCore()),
      start,
      moduleTypes: [MODULE],
      devices: DEVICES,
      limits: {},
      inputs: {},
    }));
  });

  if (made === undefined) throw new Error("no session");

  return made;
}

test("a handle drag shows each step at once and leaves one undo step", () => {
  const editing = session();
  const start = editing.draft;
  const block = start.scene.blocks[0];

  if (block === undefined) throw new Error("no block");

  for (const width of [10.5, 11, 12]) {
    editing.drag({ ...start.scene, blocks: [{ ...block, width }] });
  }

  expect(editing.draft.scene.blocks[0]?.width).toBe(12);
  expect(editing.geometry.faces.some(({ corners }) => corners.some(([east]) => east === 12))).toBe(
    true,
  );

  editing.drop();
  editing.undo();

  expect(editing.draft).toEqual(start);
  expect(editing.undoable).toBe(false);
});

test("a drag that changed nothing leaves no undo step", () => {
  const editing = session();

  editing.drag(editing.draft.scene);
  editing.drop();

  expect(editing.undoable).toBe(false);
});

test("a selected fence's point handles drag it; a drag is one undo step", () => {
  const editing = session();

  const points = [
    { x: 0, z: 10 },
    { x: 6, z: 10 },
  ];

  editing.change({
    ...editing.draft,
    scene: { ...editing.draft.scene, fences: [{ points, height: 1.2, finish: "wood" }] },
  });
  editing.go({ kind: "fence", index: 0 });

  const fenced = editing.draft;
  const handled = editing.editing;

  expect(handled?.target).toEqual({ kind: "fence", index: 0 });

  for (const x of [6.5, 7, 8]) {
    handled?.ondrag({
      ...fenced.scene,
      fences: [{ points: points.with(1, { x, z: 10 }), height: 1.2, finish: "wood" }],
    });
  }

  handled?.ondrop();

  expect(editing.draft.scene.fences?.[0]?.points[1]).toEqual({ x: 8, z: 10 });

  editing.undo();

  expect(editing.draft).toEqual(fenced);
});
