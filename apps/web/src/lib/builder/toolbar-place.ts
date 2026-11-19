// Where the context toolbar stands on the canvas (ADR 20): above the selection, below it where
// there is no room above, inside the canvas and clear of its zones. Pure, in canvas pixels.

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

/** The canvas the toolbar may stand in, and the zones inside it to keep clear of, as measured. */
export interface Room {
  readonly bounds: Box;
  readonly avoid: readonly Box[];
}

export interface Place {
  readonly left: number;
  readonly top: number;
}

/** Pixels between the toolbar and its selection: a finger's width, so the finger on a button
 * does not hide what it acts on. */
const GAP = 44;

/** Pixels the toolbar keeps from the canvas's edge and from every zone. */
const MARGIN = 12;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

const meets = (a: Box, b: Box): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** The toolbar's box at a place, with its margin round it. */
const kept = ({ left, top }: Place, { width, height }: Size): Box => ({
  left: left - MARGIN,
  top: top - MARGIN,
  right: left + width + MARGIN,
  bottom: top + height + MARGIN,
});

/** The toolbar's top left corner for a selection's box on the canvas: the first of above the
 * selection, below it, under a zone and the canvas's top, centred on the selection or beside a
 * zone, that lies in the canvas and on no zone at all. */
export function placed(selection: Box, size: Size, { bounds, avoid }: Room): Place {
  const [low, high] = [bounds.left + MARGIN, bounds.right - MARGIN - size.width];
  const centred = clamp((selection.left + selection.right) / 2 - size.width / 2, low, high);

  const tops = [
    selection.top - GAP - size.height,
    selection.bottom + GAP,
    ...avoid.map((zone) => zone.bottom + MARGIN),
    bounds.top + MARGIN,
  ].filter((top) => top >= bounds.top + MARGIN && top + size.height <= bounds.bottom - MARGIN);

  // Beside a zone, the nearest to the selection's centre first.
  const lefts = [
    centred,
    ...avoid.flatMap((zone) => [zone.left - MARGIN - size.width, zone.right + MARGIN]),
  ]
    .filter((left) => left >= low && left <= high)
    .toSorted((a, b) => Math.abs(a - centred) - Math.abs(b - centred));

  const free = tops
    .flatMap((top) => lefts.map((left): Place => ({ left, top })))
    .find((place) => avoid.every((zone) => !meets(kept(place, size), zone)));

  // No room anywhere: the first choice, however it lies.
  return free ?? { left: centred, top: tops[0] ?? bounds.top + MARGIN };
}
