/// <reference types="bun" />
import { expect, test } from "bun:test";
import { placed, type Box, type Room } from "@sunreye/builder/builder/toolbar-place.ts";

/** A phone's canvas above its peeking sheet, with the zones its owners measured: the time slider,
 * the views' and the weather's buttons, and the status line. */
const slider: Box = { left: 12, top: 12, right: 322, bottom: 52 };
const views: Box = { left: 334, top: 12, right: 378, bottom: 56 };
const weather: Box = { left: 334, top: 64, right: 378, bottom: 108 };
const status: Box = { left: 12, top: 624, right: 378, bottom: 660 };

const room: Room = {
  bounds: { left: 0, top: 0, right: 390, bottom: 672 },
  avoid: [slider, views, weather, status],
};

const size = { width: 240, height: 48 };

const meets = (a: Box, b: Box): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Whether the toolbar placed for `selection` lies in the canvas and on none of its zones. */
function clear(selection: Box, of: Readonly<typeof size> = size): boolean {
  const { left, top } = placed(selection, of, room);
  const box = { left, top, right: left + of.width, bottom: top + of.height };

  return (
    left >= 0 &&
    box.right <= 390 &&
    top >= 0 &&
    box.bottom <= 672 &&
    room.avoid.every((zone) => !meets(box, zone))
  );
}

test("the toolbar stands above the selection, centred on it, a finger's width off", () => {
  const selection = { left: 150, top: 300, right: 250, bottom: 360 };

  expect(placed(selection, size, room)).toEqual({ left: 80, top: 208 });
});

test("without room above it flips below, a finger's width off", () => {
  const high = { left: 150, top: 90, right: 250, bottom: 150 };

  expect(placed(high, size, room)).toEqual({ left: 80, top: 194 });
});

test("it stays inside the canvas, a margin off its edge", () => {
  const left = { left: 0, top: 300, right: 40, bottom: 340 };

  expect(placed(left, size, room)).toEqual({ left: 12, top: 208 });
});

test("pushed against the views' and the weather's buttons it clears both, and every other zone", () => {
  // Under the weather button: below it the toolbar would run under both buttons' column.
  const corner = { left: 330, top: 60, right: 385, bottom: 100 };

  expect(clear(corner)).toBe(true);
  // A tall toolbar, with a refusal: moved off one button it must not land on the other.
  expect(clear({ left: 300, top: 20, right: 390, bottom: 70 }, { width: 240, height: 96 })).toBe(
    true,
  );
  // By the slider and by the status line.
  expect(clear({ left: 20, top: 30, right: 120, bottom: 60 })).toBe(true);
  expect(clear({ left: 20, top: 560, right: 380, bottom: 620 })).toBe(true);
  // A selection that fills the canvas: still on no zone.
  expect(clear({ left: 0, top: 0, right: 390, bottom: 672 })).toBe(true);
});

test("a toolbar wider than the room starts at its left edge", () => {
  const selection = { left: 150, top: 300, right: 250, bottom: 360 };

  expect(placed(selection, { width: 400, height: 48 }, room)).toEqual({ left: 12, top: 208 });
});
