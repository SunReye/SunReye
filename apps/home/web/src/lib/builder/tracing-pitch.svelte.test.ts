import "../../app.css";
import { addLine, pullEaves, pullRidges, type Edited, type Scene } from "@sunreye/scene";
import { afterEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { settle } from "../motion/clock.harness.ts";
import { EMPTY, tracing } from "./tracing.harness.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

// An eave corner dragged keeps its face's pitch (ADR 20 "Points"): it follows the slope down or
// up, the pitch shown while it moves; with Alt held it keeps its height and the pitch changes.

const made = (edited: Edited): Scene => {
  if ("refused" in edited) throw new Error(edited.refused);

  return edited.scene;
};

/** The square from (2, 2) to (8, 8) as a gable: its ridge from (2, 5) to (8, 5) at 5 m, eaves at
 * 3 m. */
function gable(): Scene {
  const corners = [
    [2, 2],
    [2, 8],
    [8, 8],
    [8, 2],
  ] as const;

  const square = corners.reduce<Scene>((scene, [x, z], index) => {
    const [toX, toZ] = corners[(index + 1) % corners.length] ?? [2, 2];
    const from = index === 0 ? { x, z } : { block: 0, point: index };
    const to = index === 3 ? { block: 0, point: 0 } : { x: toX, z: toZ };

    return made(addLine(scene, from, to, 0.01));
  }, EMPTY);

  const ridged = made(addLine(square, { x: 2, z: 5 }, { x: 8, z: 5 }, 0.01));

  return made(pullRidges(made(pullEaves(ridged, 0, 3)), 0, 5));
}

/** Alt, as Chrome's input names it. */
const ALT = 1;

/** The corner at (8, 8) dragged to (8, 9), `modifiers` held; `during` runs before it is let go. */
async function dragCorner(modifiers: number, during: () => Promise<void> = async () => {}) {
  const { at, scenes } = await tracing(gable(), undefined, undefined, false);
  const mouse = { button: "left", pointerType: "mouse", clickCount: 1, modifiers } as const;
  const [[fx, fy], [mx, my], [tx, ty]] = [at(8, 8, 3), at(8, 8.5, 3), at(8, 9, 3)];

  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mousePressed", x: fx, y: fy });
  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mouseMoved", x: mx, y: my });
  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mouseMoved", x: tx, y: ty });
  await during();
  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mouseReleased", x: tx, y: ty });
  await settle(() => scenes.length === 1);

  const points = scenes[0]?.blocks[0]?.freeForm?.traced?.points ?? [];

  return points.find(([x = 0, , z = 0]) => Math.hypot(x - 8, z - 9) < 0.1);
}

test("an eave corner dragged out drops down its face's slope, the pitch shown as it moves", async () => {
  const corner = await dragCorner(0, async () => {
    await settle(() => document.querySelector("[data-dragged-pitch]") !== null);

    expect(document.querySelector("[data-dragged-pitch]")?.textContent?.trim()).toBe("34°");
  });

  expect(corner?.[1]).toBeCloseTo(5 - 8 / 3, 2);
});

test("with Alt held, the eave corner keeps its height and its face's pitch gives", async () => {
  const corner = await dragCorner(ALT);

  expect(corner?.[1]).toBeCloseTo(3, 5);
});
