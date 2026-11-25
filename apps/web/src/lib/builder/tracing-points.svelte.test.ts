import "../../app.css";
import { afterEach, expect, test, vi } from "vitest";
import { cdp, userEvent } from "vitest/browser";
import { settle } from "../motion/clock.harness.ts";
import { press } from "./pointer.harness.ts";
import { tracing, type Traced } from "./tracing.harness.ts";

// Editing what is traced on the canvas (ADR 20 "Points"): a point dragged, one put into a line by
// a double click, one tapped and taken out with Del.

afterEach(() => {
  vi.restoreAllMocks();
});

/** The square from (2, 2) to (8, 8), clicked round to its first corner. */
async function squareTraced(): Promise<Traced> {
  const traced = await tracing();

  for (const [x, z] of [
    [2, 2],
    [2, 8],
    [8, 8],
    [8, 2],
    [2, 2],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one click after another, as the person traces.
    await press("mouse", [traced.at(x, z)]);
  }

  await settle(() => traced.scenes.length === 4);

  return traced;
}

/** Two clicks on the same spot, the second a double click, through the browser's input. */
async function doubleClick([x, y]: readonly [number, number]): Promise<void> {
  for (const clickCount of [1, 2]) {
    const mouse = { button: "left", pointerType: "mouse", clickCount, x, y } as const;

    // oxlint-disable-next-line no-await-in-loop -- a double click is two clicks in a row.
    await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mousePressed" });
    // oxlint-disable-next-line no-await-in-loop -- a double click is two clicks in a row.
    await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mouseReleased" });
  }
}

test("a traced point dragged moves alone, and its face follows", async () => {
  const { at, scenes, edits } = await squareTraced();

  await press("mouse", [at(8, 8), at(8.5, 8.5), at(9, 9)]);
  await settle(() => scenes.length === 5);

  expect(edits.at(-1)).toMatchObject({ kind: "movePoint", block: 0 });
  expect(
    scenes.at(-1)?.blocks[0]?.freeForm?.traced?.points.map(([x = 0]) => Math.round(x)),
  ).toContain(9);
});

test("a double click on a traced line puts a point into it there", async () => {
  const { at, scenes, edits } = await squareTraced();

  await doubleClick(at(2, 5));
  await settle(() => edits.some((edit) => edit.kind === "split"));

  expect(edits.at(-1)).toMatchObject({ kind: "split", block: 0 });
  expect(scenes.at(-1)?.blocks[0]?.freeForm?.traced?.lines).toHaveLength(5);
});

test("Del on a point tapped takes it out, its two lines joined", async () => {
  const { at, scenes, edits } = await squareTraced();

  await press("mouse", [at(8, 8)]);
  await userEvent.keyboard("{Delete}");
  await settle(() => scenes.length === 5);

  expect(edits.at(-1)).toMatchObject({ kind: "removePoint", block: 0 });
  expect(scenes.at(-1)?.blocks[0]?.freeForm?.faces[0]).toHaveLength(3);
});

test("a line dragged shows the whole straight run it moves and the lines it stretches", async () => {
  const { at, edits } = await squareTraced();

  await doubleClick(at(2, 5));
  await settle(() => edits.some((edit) => edit.kind === "split"));

  const mouse = { button: "left", pointerType: "mouse", clickCount: 1 } as const;
  const [[gx, gy], [tx, ty]] = [at(2, 3.5), at(1, 3.5)];

  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mousePressed", x: gx, y: gy });
  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mouseMoved", x: tx, y: ty });

  // The west side's two pieces and the north and south sides they stretch.
  await settle(() => document.querySelectorAll('line[stroke-dasharray="6 4"]').length === 4);

  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mouseReleased", x: tx, y: ty });
});
