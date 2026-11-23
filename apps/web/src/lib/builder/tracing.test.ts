/// <reference types="bun" />
import { expect, test } from "bun:test";
import { loadPv } from "@sunreye/pv-wasm";
import { addLine, type End, type Scene } from "@sunreye/scene";

// A traced roof as the pv crate reads it (ADR 20): the faces the tracing derives face up and
// carry modules, so the core would save them.

const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

const RIDGE = 4 * Math.tan((35 * Math.PI) / 180) + 3;

/** Clicks on a surface at x, z and height, each joined to the last. */
function traced(scene: Scene, ...clicks: readonly (readonly [number, number, number])[]): Scene {
  let at = scene;
  let from: End | undefined;

  for (const [x, z, height] of clicks) {
    if (from === undefined) {
      from = { x, z, height };
      continue;
    }

    const edited = addLine(at, from, { x, z, height }, 0.3);

    if ("refused" in edited) throw new Error(edited.refused);

    at = edited.scene;
    from = { block: edited.block, point: edited.to };
  }

  return at;
}

test("a gable traced on a surface is two faces at its pitch, and a module lies on one", () => {
  const outline = traced(
    { north: 0, blocks: [], obstacles: [] },
    [0, 0, 3],
    [0, 4, RIDGE],
    [0, 8, 3],
    [10, 8, 3],
    [10, 4, RIDGE],
    [10, 0, 3],
    [0, 0, 3],
  );

  const gable = traced(outline, [0, 4, RIDGE], [10, 4, RIDGE]);

  const scene: Scene = {
    ...gable,
    grids: [
      {
        block: 0,
        face: 1,
        moduleType: 1,
        landscape: false,
        setback: 0.3,
        modules: [{ across: 1, up: 1, landscape: false }],
      },
    ],
  };

  const laid = pv.modules(scene, { 1: { width: 1.134, height: 1.722 } });

  expect(laid.roofs.map(({ tilt }) => Math.round(tilt))).toEqual([35, 35]);
  expect(laid.misplaced).toBeNull();
  expect(laid.grids[0]?.modules).toHaveLength(1);
});
