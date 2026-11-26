import "../../app.css";
import { addLine, type Scene } from "@sunreye/scene";
import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { settle } from "../motion/clock.harness.ts";
import { press } from "./pointer.harness.ts";
import { EMPTY, tracing } from "./tracing.harness.ts";

// Editing what is traced without drawing (ADR 20 "Points"), as a pick tool does: a traced point
// or line is taken, anything else is left to picking and the camera, and no tap draws.

afterEach(() => {
  vi.restoreAllMocks();
});

/** The square from (2, 2) to (8, 8), closed into a face. */
function square(): Scene {
  const corners = [
    [2, 2],
    [2, 8],
    [8, 8],
    [8, 2],
  ] as const;

  return corners.reduce<Scene>((scene, [x, z], index) => {
    const [toX, toZ] = corners[(index + 1) % corners.length] ?? [2, 2];
    const from = index === 0 ? { x, z } : { block: 0, point: index };
    const to = index === 3 ? { block: 0, point: 0 } : { x: toX, z: toZ };
    const edited = addLine(scene, from, to, 0.01);

    if ("refused" in edited) throw new Error(edited.refused);

    return edited.scene;
  }, EMPTY);
}

test("taps on open ground draw nothing, and reach the canvas's picking", async () => {
  const { at, edits } = await tracing(square(), undefined, undefined, false);
  const picking = vi.fn<() => void>();

  document.querySelector("canvas")?.addEventListener("pointerdown", picking);

  await press("mouse", [at(0.5, 0.5)]);

  expect(picking).toHaveBeenCalled();

  await press("mouse", [at(0.5, 9.5)]);
  await press("mouse", [at(9.5, 9.5)]);

  expect(edits).toEqual([]);
});

test("a traced point is dragged, and one tapped is taken out with Del", async () => {
  const { at, scenes, edits } = await tracing(square(), undefined, undefined, false);

  await press("mouse", [at(8, 8), at(8.5, 8.5), at(9, 9)]);
  await settle(() => edits.length === 1);

  expect(edits[0]).toMatchObject({ kind: "movePoint", block: 0 });

  const keys = vi.fn<() => void>();

  document.addEventListener("keydown", keys);
  await userEvent.keyboard("{Delete}");

  // Nothing tapped: Del is the page's, which removes what it picked.
  expect(keys).toHaveBeenCalledTimes(1);

  await press("mouse", [at(2, 2)]);
  await userEvent.keyboard("{Delete}");
  await settle(() => edits.length === 2);

  // The tapped point's: the page's Del removes nothing besides.
  expect(keys).toHaveBeenCalledTimes(1);

  expect(edits[1]).toMatchObject({ kind: "removePoint", block: 0 });
  expect(scenes.at(-1)?.blocks[0]?.freeForm?.faces[0]).toHaveLength(3);
});
