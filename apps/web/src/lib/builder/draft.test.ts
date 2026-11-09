/// <reference types="bun" />
import { expect, test } from "bun:test";
import { nextBlock, withRoof } from "./draft.ts";

test("the first block stands at the origin and the next beside the last, 2 m apart", () => {
  const first = nextBlock([]);

  expect([first.x, first.z]).toEqual([0, 0]);

  const second = nextBlock([{ ...first, x: 3, width: 12 }]);

  expect([second.x, second.z]).toEqual([17, 0]);
});

test("a flat roof drops its pitch and a pitched roof keeps the one it had", () => {
  expect(withRoof({ kind: "gable", pitch: 30 }, "flat")).toEqual({ kind: "flat" });
  expect(withRoof({ kind: "gable", pitch: 30 }, "hip")).toEqual({ kind: "hip", pitch: 30 });
  expect(withRoof({ kind: "flat" }, "monoPitch")).toEqual({ kind: "monoPitch", pitch: 35 });
});
