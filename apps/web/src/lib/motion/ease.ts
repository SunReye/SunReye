// ADR 21's ease-in-out as a function, kept apart from the rune shell so plain modules and `bun test` reach it.

const bezier = (a: number, c: number, s: number) =>
  3 * a * (1 - s) ** 2 * s + 3 * c * (1 - s) * s ** 2 + s ** 3;

/** ADR 21's `--motion-ease-in-out`, cubic-bezier(0.65, 0, 0.35, 1), solved by bisection. */
export const easeInOut = (t: number): number => {
  if (t <= 0) return 0;

  if (t >= 1) return 1;

  let lo = 0;
  let hi = 1;

  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;

    if (bezier(0.65, 0.35, mid) < t) lo = mid;
    else hi = mid;
  }

  return bezier(0, 1, (lo + hi) / 2);
};
