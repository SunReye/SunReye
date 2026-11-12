import { expect, test } from "vitest";
import { connect } from "../../api/core.ts";
import { DEVICES, house, MODULE, pv, testCore } from "../builder.harness.ts";
import { Session } from "../session.svelte.ts";

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
