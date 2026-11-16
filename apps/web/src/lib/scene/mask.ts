// Where a ground finish lies on the imported terrain (ADR 20), as a mask the terrain is drawn
// through: areas and lines painted into bytes, a pixel a node of a square grid. Pure.

/** Across and up, in pixels. */
export type Spot = readonly [number, number];

/** Where the outline's edges cross the row at `y`, left to right. */
function crossings(outline: readonly Spot[], y: number): number[] {
  const found: number[] = [];

  for (const [i, [bx, by]] of outline.entries()) {
    const [ax, ay] = outline[(i + outline.length - 1) % outline.length] ?? [bx, by];

    if (ay <= y !== by <= y) found.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
  }

  return found.toSorted((a, b) => a - b);
}

/** Sets to 255 every pixel of the `size` by `size` mask whose centre lies inside `outline`. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- painted in place.
export function paint(mask: Uint8Array, size: number, outline: readonly Spot[]): void {
  const ys = outline.map(([, y]) => y);
  const first = Math.max(0, Math.floor(Math.min(...ys)));
  const last = Math.min(size - 1, Math.ceil(Math.max(...ys)));

  for (let row = first; row <= last; row++) {
    const found = crossings(outline, row + 0.5);

    for (let i = 0; i + 1 < found.length; i += 2) {
      const from = Math.max(0, Math.ceil((found[i] ?? 0) - 0.5));
      const to = Math.min(size - 1, Math.floor((found[i + 1] ?? 0) - 0.5));

      if (from <= to) mask.fill(255, row * size + from, row * size + to + 1);
    }
  }
}

/** A round joint's corners. */
const JOINT = 12;

/** A line `width` pixels wide as outlines to paint: a rectangle along each stretch and a disc on
 * each point, so bends and ends are round. */
export function stroke(points: readonly Spot[], width: number): Spot[][] {
  const half = width / 2;

  return points.flatMap(([bx, by], i) => {
    const disc = Array.from({ length: JOINT }, (_, k): Spot => {
      const angle = (k / JOINT) * 2 * Math.PI;

      return [bx + half * Math.cos(angle), by + half * Math.sin(angle)];
    });

    const [ax, ay] = points[i - 1] ?? [bx, by];
    const length = Math.hypot(bx - ax, by - ay);

    if (length === 0) return [disc];

    const [nx, ny] = [(-(by - ay) / length) * half, ((bx - ax) / length) * half];

    return [
      disc,
      [
        [ax - nx, ay - ny],
        [bx - nx, by - ny],
        [bx + nx, by + ny],
        [ax + nx, ay + ny],
      ],
    ];
  });
}

/** Softens one line of the mask, `step` bytes from each pixel to the next: 1, 2, 1. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- softened in place.
function blur(mask: Uint8Array, line: Uint8Array, start: number, step: number): void {
  const last = line.length - 1;

  for (let i = 0; i <= last; i++) line[i] = mask[start + i * step] ?? 0;

  for (let i = 0; i <= last; i++) {
    const around = (line[Math.max(i - 1, 0)] ?? 0) + (line[Math.min(i + 1, last)] ?? 0);

    mask[start + i * step] = (around + 2 * (line[i] ?? 0) + 2) >> 2;
  }
}

/** Softens a painted mask in place, a pixel each way: drawn through at half its strength, a
 * finish's edge then runs smooth where the pixels step. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- softened in place.
export function soften(mask: Uint8Array, size: number): void {
  const line = new Uint8Array(size);

  // Along each row, then along each column.
  for (let row = 0; row < size; row++) blur(mask, line, row * size, 1);

  for (let column = 0; column < size; column++) blur(mask, line, column, size);
}
