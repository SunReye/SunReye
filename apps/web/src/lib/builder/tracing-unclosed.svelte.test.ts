import "../../app.css";
import { addLine, type Scene } from "@sunreye/scene";
import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { settle } from "../motion/clock.harness.ts";
import { press } from "./pointer.harness.ts";
import { EMPTY, tracing } from "./tracing.harness.ts";

// An outline left open is no roof (ADR 20 "Points"): the chain that made it taken out when it ends
// unclosed, and every one left before taken out when the next chain starts.

afterEach(() => {
  vi.restoreAllMocks();
});

/** Two sides of a square traced into a new roof and left open, as a reload finds them. */
function leftOpen(): Scene {
  const first = addLine(EMPTY, { x: 2, z: 2 }, { x: 2, z: 8 }, 0.3);

  if ("refused" in first) throw new Error(first.refused);

  const second = addLine(first.scene, { block: 0, point: 1 }, { x: 8, z: 8 }, 0.3);

  if ("refused" in second) throw new Error(second.refused);

  return second.scene;
}

test("Esc on a new roof's outline left open takes it out as one edit", async () => {
  const { at, scenes, edits } = await tracing(EMPTY, undefined, "new");

  for (const [x, z] of [
    [2, 2],
    [2, 8],
    [8, 8],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one click after another, as the person traces.
    await press("mouse", [at(x, z)]);
  }

  await settle(() => scenes.length === 2);
  await userEvent.keyboard("{Escape}");
  await settle(() => edits.length === 3);

  expect(edits.at(-1)).toEqual({ kind: "removeBlock", block: 0 });
  expect(scenes.at(-1)?.blocks).toEqual([]);
});

test("Esc on an outline left open takes it out, a roof named or not", async () => {
  const { at, scenes, edits } = await tracing();

  for (const [x, z] of [
    [2, 2],
    [2, 8],
    [8, 8],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one click after another, as the person traces.
    await press("mouse", [at(x, z)]);
  }

  await settle(() => scenes.length === 2);
  await userEvent.keyboard("{Escape}");
  await settle(() => edits.length === 3);

  expect(edits.at(-1)).toEqual({ kind: "removeBlock", block: 0 });
});

test("a chain started elsewhere first takes out an outline left open before", async () => {
  const { at, scenes, edits } = await tracing(leftOpen(), undefined, "new");

  await press("mouse", [at(5, 5)]);
  await settle(() => edits.length === 1);

  expect(edits[0]).toEqual({ kind: "removeBlock", block: 0 });
  expect(scenes.at(-1)?.blocks).toEqual([]);
});

test("a chain started on an open outline's end goes on with it", async () => {
  const { at, scenes, edits } = await tracing(leftOpen());

  await press("mouse", [at(8, 8)]);
  await press("mouse", [at(8, 2)]);
  await settle(() => edits.length === 1);

  expect(edits[0]).toMatchObject({ kind: "add" });
  expect(scenes.at(-1)?.blocks[0]?.freeForm?.traced?.lines).toHaveLength(3);
});

test("tracing turned off ends its chain: turned on again, a click starts another", async () => {
  const { at, edits, retool } = await tracing();

  await press("mouse", [at(2, 2)]);
  await press("mouse", [at(2, 8)]);
  await settle(() => edits.length === 1);

  await retool("off");
  await retool("draw");

  await press("mouse", [at(8, 8)]);
  await press("mouse", [at(8, 2)]);
  await settle(() => edits.length === 3);

  expect(edits.map((edit) => edit.kind)).toEqual(["add", "removeBlock", "add"]);
});

test("switched to editing, the chain ends: a traced point is dragged, no line drawn on", async () => {
  const { at, scenes, edits, retool } = await tracing();

  await press("mouse", [at(2, 2)]);
  await press("mouse", [at(2, 8)]);
  await press("mouse", [at(8, 8)]);
  await settle(() => edits.length === 2);

  await retool("edit");
  await press("mouse", [at(8, 8), at(8.5, 7.5), at(9, 7)]);
  await settle(() => edits.length === 3);

  expect(edits.at(-1)).toMatchObject({ kind: "movePoint" });
  expect(scenes.at(-1)?.blocks[0]?.freeForm?.traced?.lines).toHaveLength(2);
});
