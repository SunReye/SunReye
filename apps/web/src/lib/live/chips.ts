// Where the 3D label chips sit (ADR 20): in rows above and below the house, each row in its
// markers' order, never overlapping and inside the canvas. Pure: pixels in, pixels out.

/** A chip's centre and size, in canvas pixels. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A chip to place. */
export interface Label {
  readonly key: string;
  readonly w: number;
  readonly h: number;
  /** The side of the house its rows stack on. */
  readonly lane: "above" | "below";
  /** Chips of one group share rows; the lowest group lies nearest the house. */
  readonly group: number;
  /** Where its leader line ends, across the canvas; null without one. */
  readonly x: number | null;
}

/** The canvas the chips share with the house. */
export interface Frame {
  readonly width: number;
  readonly height: number;
  /** Pixels at the top that stay free: the headline's. */
  readonly top: number;
  /** The house on the canvas. */
  readonly house: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
}

/** Pixels between two chips. */
const GAP = 6;

/** Pixels between a chip and the canvas edge. */
const EDGE = 8;

/** Pixels between the house and its nearest row. */
const CLEAR = 10;

/** A chip in its row: where it would sit with the row to itself. */
interface Seat {
  readonly at: number;
  readonly x: number;
  readonly w: number;
}

interface Row {
  readonly seats: readonly Seat[];
  readonly y: number;
  readonly h: number;
}

/** Each label's box, by position in `labels`. */
export function arrange(labels: readonly Label[], frame: Frame): Box[] {
  // Top to bottom.
  const rows = [...lane(labels, "above", frame).toReversed(), ...lane(labels, "below", frame)];

  const down = line(
    rows.map(({ y, h }) => ({ ideal: y, size: h })),
    frame.top + EDGE,
    frame.height - EDGE,
  );

  const boxes: Box[] = [];

  for (const [i, { seats }] of rows.entries()) {
    const across = line(
      seats.map(({ x, w }) => ({ ideal: x, size: w })),
      EDGE,
      frame.width - EDGE,
    );

    for (const [j, { at }] of seats.entries()) {
      const { w, h } = labels[at]!;

      boxes[at] = { x: across[j]!, y: down[i]!, w, h };
    }
  }

  return boxes;
}

/** A lane's rows, nearest the house first. */
function lane(labels: readonly Label[], side: Label["lane"], frame: Frame): Row[] {
  const members = labels.flatMap((label, at) => (label.lane === side ? [{ ...label, at }] : []));
  const groups = [...new Set(members.map(({ group }) => group))].toSorted((a, b) => a - b);
  const { house } = frame;
  let offset = CLEAR;

  return groups
    .flatMap((group) =>
      wrap(
        seated(
          members.filter((member) => member.group === group),
          frame,
        ),
        frame.width - 2 * EDGE,
      ),
    )
    .map((seats) => {
      const h = Math.max(...seats.map(({ at }) => labels[at]!.h));
      const y = side === "above" ? house.top - offset - h / 2 : house.bottom + offset + h / 2;

      offset += h + GAP;

      return { seats, y, h };
    });
}

/**
 * A group in its markers' order, so its leader lines do not cross. Chips without a marker line up
 * beside the marked ones on the canvas's roomier side, or under the house when none is marked.
 */
function seated(members: readonly (Label & { readonly at: number })[], frame: Frame): Seat[] {
  const marked = members
    .flatMap(({ at, x, w }) => (x === null ? [] : [{ at, x, w }]))
    .toSorted((a, b) => a.x - b.x);

  const loose = members.filter(({ x }) => x === null);

  if (marked.length === 0) {
    const total = loose.reduce((sum, { w }) => sum + w + GAP, -GAP);
    let left = (frame.house.left + frame.house.right) / 2 - total / 2;

    return loose.map(({ at, w }) => {
      const seat = { at, x: left + w / 2, w };

      left += w + GAP;

      return seat;
    });
  }

  const mean = marked.reduce((sum, { x }) => sum + x, 0) / marked.length;

  if (mean >= frame.width / 2) {
    let next = marked[0]!;

    const before = loose.toReversed().map(({ at, w }) => {
      next = { at, x: next.x - (next.w + w) / 2 - GAP, w };

      return next;
    });

    return [...before.toReversed(), ...marked];
  }

  let last = marked.at(-1)!;

  const after = loose.map(({ at, w }) => {
    last = { at, x: last.x + (last.w + w) / 2 + GAP, w };

    return last;
  });

  return [...marked, ...after];
}

/** The fewest rows of neighbours, evenly filled, that each fit `room`. */
function wrap(seats: readonly Seat[], room: number): Seat[][] {
  for (let count = 1; count < seats.length; count++) {
    const size = Math.ceil(seats.length / count);

    const rows = Array.from({ length: count }, (_, row) =>
      seats.slice(row * size, (row + 1) * size),
    ).filter((row) => row.length > 0);

    if (rows.every((row) => row.reduce((sum, { w }) => sum + w + GAP, -GAP) <= room)) return rows;
  }

  return seats.map((seat) => [seat]);
}

interface Item {
  readonly ideal: number;
  readonly size: number;
}

/**
 * Centres for `items` in their order along one axis: each as near its ideal as its neighbours
 * and the bounds allow, `GAP` apart.
 */
function line(items: readonly Item[], low: number, high: number): number[] {
  const forth = pushed(items, low, high);

  // The same from the far end, mirrored: the mean of the two leans to neither end.
  const back = pushed(
    items.toReversed().map(({ ideal, size }) => ({ ideal: -ideal, size })),
    -high,
    -low,
  )
    .toReversed()
    .map((centre) => -centre);

  return forth.map((centre, i) => (centre + back[i]!) / 2);
}

/** Pushes each item past the one before it, then back inside the far bound. */
function pushed(items: readonly Item[], low: number, high: number): number[] {
  const centres: number[] = [];
  let edge = low;

  for (const { ideal, size } of items) {
    const centre = Math.max(ideal, edge + size / 2);

    centres.push(centre);
    edge = centre + size / 2 + GAP;
  }

  edge = high;

  for (let i = items.length - 1; i >= 0; i--) {
    const { size } = items[i]!;
    const centre = Math.min(centres[i]!, edge - size / 2);

    centres[i] = centre;
    edge = centre - size / 2 - GAP;
  }

  return centres;
}

/**
 * Values that follow their targets only once those leave a band around them: a chip keeps its
 * place through a small camera move, and never flips between two orders.
 */
export class Steady {
  readonly #band: number;
  readonly #held = new Map<string, number>();

  constructor(band: number) {
    this.#band = band;
  }

  follow(key: string, target: number): number {
    const held = this.#held.get(key) ?? target;
    const next = Math.max(target - this.#band, Math.min(target + this.#band, held));

    this.#held.set(key, next);

    return next;
  }

  clear(): void {
    this.#held.clear();
  }
}
