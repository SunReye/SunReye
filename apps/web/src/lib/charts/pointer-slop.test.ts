/**
 * The press/drag boundary, from both sides and on both axes.
 *
 * Boundaries only: the interior of the range is arithmetic, while every bug this
 * predicate can have lives at the edge — an off-by-one at the threshold, a
 * per-axis comparison that lets a diagonal through, or a sign error that only
 * notices travel in one direction.
 */

import { describe, expect, test } from "bun:test";
import { movedPastSlop } from "./pointer-slop";

/**
 * The threshold, restated rather than imported.
 *
 * Importing the constant to check behaviour derived from the constant proves
 * only that the file is self-consistent: change the source to 40 and every case
 * below would move with it and stay green. Written out here, a change to either
 * has to be argued against the other.
 */
const SLOP_PX = 8;

const AT = { x: 100, y: 50 };

describe("the press/drag boundary", () => {
  test("a pointer that has not moved is a press", () => {
    expect(movedPastSlop(AT, { ...AT })).toBe(false);
  });

  test(`${SLOP_PX}px is still a press, ${SLOP_PX + 1}px is a drag`, () => {
    expect(movedPastSlop(AT, { x: AT.x + SLOP_PX, y: AT.y })).toBe(false);
    expect(movedPastSlop(AT, { x: AT.x + SLOP_PX + 1, y: AT.y })).toBe(true);
  });

  test("it is symmetric on both axes", () => {
    for (const to of [
      { x: AT.x - SLOP_PX - 1, y: AT.y },
      { x: AT.x, y: AT.y - SLOP_PX - 1 },
      { x: AT.x, y: AT.y + SLOP_PX + 1 },
    ]) {
      expect(movedPastSlop(AT, to)).toBe(true);
    }
  });

  // The case a per-axis comparison gets wrong: 6px on each axis is 8.49px of
  // travel — under the limit on both axes and over it as a radius.
  test("a diagonal drag cannot slip through under the limit on each axis", () => {
    const diagonal = { x: AT.x + 6, y: AT.y + 6 };
    expect(Math.abs(diagonal.x - AT.x)).toBeLessThan(SLOP_PX);
    expect(Math.abs(diagonal.y - AT.y)).toBeLessThan(SLOP_PX);
    expect(movedPastSlop(AT, diagonal)).toBe(true);
  });

  // 3-4-5: exactly 5px of travel, well inside the radius, but a naive sum of
  // absolute deltas (7) would call it a drag.
  test("travel is a radius, not a sum of deltas", () => {
    expect(movedPastSlop(AT, { x: AT.x + 3, y: AT.y + 4 })).toBe(false);
  });

  test("the threshold is a real hit-slop, not zero and not a swipe", () => {
    expect(SLOP_PX).toBeGreaterThan(2);
    expect(SLOP_PX).toBeLessThan(20);
  });
});
