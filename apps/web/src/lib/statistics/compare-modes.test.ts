/**
 * The comparison reference is PAGE state, so its control belongs to the page.
 *
 * It was a `RangeSwitcher` inside the Records section, which is the one section
 * that does NOT own it: `mode` is held by `+page.svelte`, it is what the
 * comparison request is made with, and every section's delta chips and every
 * section caption are re-based by it. A control for page state living inside one
 * of four sections is why the Records header read as a second toolbar.
 */

import { describe, expect, test } from "bun:test";
import { compareModes } from "./compare-modes";

describe("compareModes", () => {
  test("offers exactly the two reference windows the server prices", () => {
    expect(compareModes().map((o) => o.id)).toEqual(["previous", "yearAgo"]);
  });

  test("both options are named, and named differently", () => {
    const labels = compareModes().map((o) => o.label);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });

  // Two options, so the segmented row still fits a phone and no Select form is
  // needed — `needsCompactSwitcher` is what the switcher asks, and a third
  // option here would silently change the control's phone shape.
  test("it stays a two-option switcher, which is what fits the page toolbar", () => {
    expect(compareModes()).toHaveLength(2);
  });
});
