/// <reference types="bun" />
import { expect, test } from "bun:test";
import { paint, stroke } from "./mask.ts";

/** The mask's rows as text, top row last: `#` inside. */
function rows(mask: Uint8Array, size: number): string[] {
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (__, x) => (mask[y * size + x] === 255 ? "#" : ".")).join(""),
  );
}

test("an area paints the pixels whose centres lie inside its outline", () => {
  const mask = new Uint8Array(16);

  paint(mask, 4, [
    [1, 1],
    [3, 1],
    [3, 3],
    [1, 3],
  ]);

  expect(rows(mask, 4)).toEqual(["....", ".##.", ".##.", "...."]);
});

test("a hollow outline leaves its notch unpainted, and what lies off the mask is left out", () => {
  const mask = new Uint8Array(25);

  // A U open to the right, reaching past the left edge.
  paint(mask, 5, [
    [-2, 0],
    [5, 0],
    [5, 1],
    [1, 1],
    [1, 4],
    [5, 4],
    [5, 5],
    [-2, 5],
  ]);

  expect(rows(mask, 5)).toEqual(["#####", "#....", "#....", "#....", "#####"]);
});

test("a line paints its width along every stretch and round its bends", () => {
  const mask = new Uint8Array(36);

  for (const piece of stroke(
    [
      [0, 1],
      [5, 1],
      [5, 6],
    ],
    2,
  )) {
    paint(mask, 6, piece);
  }

  expect(rows(mask, 6)).toEqual(["######", "######", "....##", "....##", "....##", "....##"]);
});
