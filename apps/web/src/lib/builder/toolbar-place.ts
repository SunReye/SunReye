// Where the context toolbar stands on the canvas (ADR 20): above the selection, below it where
// there is no room above, inside the canvas and clear of its fixed zones. Pure, in canvas pixels.

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The canvas the toolbar may stand in, and the buttons inside it to keep clear of. */
export interface Room {
  readonly bounds: Box;
  readonly avoid: readonly Box[];
}

export interface Place {
  readonly left: number;
  readonly top: number;
}

/** Pixels between the toolbar and its selection, and anything it keeps clear of: a finger's width
 * would hide the selection, so a little less. */
const GAP = 12;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

const meets = (a: Box, b: Box): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** The toolbar's top: above the selection, else below it, else at the room's top. */
function topOf(selection: Box, { height }: Size, { bounds }: Room): number {
  const above = selection.top - GAP - height;
  const below = selection.bottom + GAP;

  if (above >= bounds.top) return above;

  return below + height <= bounds.bottom ? below : bounds.top;
}

/** The toolbar's top left corner for a selection's box on the canvas. */
export function placed(selection: Box, size: Size, room: Room): Place {
  const { bounds, avoid } = room;
  const centred = (selection.left + selection.right) / 2 - size.width / 2;
  const left = clamp(centred, bounds.left, bounds.right - size.width);
  const top = topOf(selection, size, room);
  const box = { left, top, right: left + size.width, bottom: top + size.height };
  const struck = avoid.find((button) => meets(box, button));

  // Left of a button it would cover, where the room reaches that far.
  return struck === undefined
    ? { left, top }
    : { left: clamp(struck.left - GAP - size.width, bounds.left, left), top };
}
