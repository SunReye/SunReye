// Where the 3D label chips sit (ADR 20): pushed apart so they never overlap, and kept inside the
// canvas. Ported from the prototype's Scene3d placeChips. Pure: pixels in, pixels out.

/** A chip's centre and size, in canvas pixels. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Pixels between two chips. */
const GAP = 6;

/** Pixels between a chip and the canvas edge. */
const EDGE = 8;

const ROUNDS = 40;

export function spread(boxes: readonly Box[], width: number, height: number): Box[] {
  let moved = [...boxes];

  for (let round = 0; round < ROUNDS; round++) {
    for (let i = 0; i < moved.length; i++) {
      for (let j = i + 1; j < moved.length; j++) {
        const [a, b] = apart(moved[i]!, moved[j]!);

        moved[i] = a;
        moved[j] = b;
      }
    }

    moved = moved.map((box) => inside(box, width, height));
  }

  return moved;
}

/** Splits an overlap between `a` and `b` along its shorter side; `a` goes up or left. */
function apart(a: Box, b: Box): readonly [Box, Box] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ox = (a.w + b.w) / 2 + GAP - Math.abs(dx);
  const oy = (a.h + b.h) / 2 + GAP - Math.abs(dy);

  if (ox <= 0 || oy <= 0) return [a, b];

  if (oy < ox) {
    const shift = (dy === 0 ? 1 : Math.sign(dy)) * (oy / 2);

    return [
      { ...a, y: a.y - shift },
      { ...b, y: b.y + shift },
    ];
  }

  const shift = (dx === 0 ? 1 : Math.sign(dx)) * (ox / 2);

  return [
    { ...a, x: a.x - shift },
    { ...b, x: b.x + shift },
  ];
}

function inside(box: Box, width: number, height: number): Box {
  return {
    ...box,
    x: clamp(box.x, box.w / 2 + EDGE, width - box.w / 2 - EDGE),
    y: clamp(box.y, box.h / 2 + EDGE, height - box.h / 2 - EDGE),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
