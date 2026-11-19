/// <reference types="bun" />
import { expect, test } from "bun:test";
import { placed, type Room } from "./toolbar-place.ts";

/** A phone's canvas: the time slider above 64 px, the status line and the sheet below 612 px, and
 * the weather button under the views' at the right. */
const room: Room = {
  bounds: { left: 12, top: 64, right: 378, bottom: 612 },
  avoid: [{ left: 334, top: 12, right: 378, bottom: 108 }],
};

const size = { width: 240, height: 48 };

test("the toolbar stands above the selection, centred on it, a finger's width off", () => {
  const selection = { left: 150, top: 300, right: 250, bottom: 360 };

  expect(placed(selection, size, room)).toEqual({ left: 80, top: 240 });
});

test("without room above it flips below; a selection that fills the canvas keeps it at the top", () => {
  const high = { left: 150, top: 90, right: 250, bottom: 150 };

  expect(placed(high, size, room)).toEqual({ left: 80, top: 162 });

  const whole = { left: 0, top: 70, right: 390, bottom: 640 };

  expect(placed(whole, size, room)).toEqual({ left: 75, top: 64 });
});

test("it stays inside the canvas and clear of the buttons at its edge", () => {
  const left = { left: 0, top: 300, right: 40, bottom: 340 };

  expect(placed(left, size, room)).toEqual({ left: 12, top: 240 });

  // Above would lie in the slider's row and below beside the weather button: it moves left of it.
  const corner = { left: 330, top: 40, right: 380, bottom: 60 };

  expect(placed(corner, size, room)).toEqual({ left: 82, top: 72 });
});

test("a toolbar wider than the room starts at its left edge", () => {
  const selection = { left: 150, top: 300, right: 250, bottom: 360 };

  expect(placed(selection, { width: 400, height: 48 }, room)).toEqual({ left: 12, top: 240 });
});
