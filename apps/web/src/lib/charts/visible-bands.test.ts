/**
 * What a narrowed band domain does to the marks drawn in chart space.
 *
 * Zooming a band scale replaces the domain with a subrange of it. Anything the
 * chart draws by looking a value up in that scale — the price track's
 * negative-window shading, its "now" rule — then gets `undefined` back for a
 * band that scrolled off. `bandSpan` reads that as 0 and paints the shading at
 * the left edge of the plot, so a zoom into the evening claims the morning was
 * free. These helpers are what keeps those marks honest.
 */

import { describe, expect, test } from "bun:test";
import { clipRunsToDomain, isBandVisible, visibleBandRange } from "./visible-bands";

const all = ["00:00", "00:15", "00:30", "00:45", "01:00", "01:15"];
const run = (first: string, last: string) => ({ first, last });

describe("visibleBandRange", () => {
  test("an unzoomed chart shows the whole band list", () => {
    expect(visibleBandRange(all, all)).toEqual([0, 5]);
  });

  test("a zoomed domain is the positions its ends occupy", () => {
    expect(visibleBandRange(all, ["00:30", "00:45", "01:00"])).toEqual([2, 4]);
  });

  test("an empty visible domain shows nothing", () => {
    expect(visibleBandRange(all, [])).toBeNull();
  });

  test("an empty band list has no positions to report", () => {
    expect(visibleBandRange([], ["00:30"])).toBeNull();
  });

  // The domain can outlive the rows it was built from for a frame after a
  // refetch. Positions that no longer exist are not a window.
  test("a domain whose ends are gone from the rows is not a window", () => {
    expect(visibleBandRange(all, ["23:45", "23:59"])).toBeNull();
  });

  test("a single visible band is a one-wide window", () => {
    expect(visibleBandRange(all, ["01:00"])).toEqual([4, 4]);
  });
});

describe("clipRunsToDomain", () => {
  test("an unzoomed chart keeps every run untouched", () => {
    const runs = [run("00:15", "00:30")];
    expect(clipRunsToDomain(runs, all, all)).toEqual(runs);
  });

  test("a run entirely off the zoomed domain is dropped", () => {
    expect(clipRunsToDomain([run("00:00", "00:15")], all, ["00:45", "01:00"])).toEqual([]);
  });

  // The failure this exists for: without clipping, `bandSpan` looks up a band
  // the scale no longer knows, gets `undefined`, and shades from x = 0.
  test("a run hanging off the left edge is clipped to the first visible band", () => {
    expect(clipRunsToDomain([run("00:00", "01:00")], all, ["00:30", "00:45", "01:00"])).toEqual([
      run("00:30", "01:00"),
    ]);
  });

  test("a run hanging off the right edge is clipped to the last visible band", () => {
    expect(clipRunsToDomain([run("00:15", "01:15")], all, ["00:15", "00:30", "00:45"])).toEqual([
      run("00:15", "00:45"),
    ]);
  });

  test("a run wider than the zoom fills it", () => {
    expect(clipRunsToDomain([run("00:00", "01:15")], all, ["00:30", "00:45"])).toEqual([
      run("00:30", "00:45"),
    ]);
  });

  test("a zoom that shows nothing draws no runs", () => {
    expect(clipRunsToDomain([run("00:00", "01:15")], all, [])).toEqual([]);
  });

  test("a run whose bands are not in the row list is dropped, not guessed at", () => {
    expect(clipRunsToDomain([run("09:00", "09:15")], all, all)).toEqual([]);
  });

  // Clipping must not lose whatever else the run carries — the price chart keys
  // its `{#each}` on the run object's own fields.
  test("clipping preserves the rest of the run", () => {
    const runs = [{ first: "00:00", last: "01:00", ct: -0.5 }];
    expect(clipRunsToDomain(runs, all, ["00:30", "00:45"])).toEqual([
      { first: "00:30", last: "00:45", ct: -0.5 },
    ]);
  });
});

describe("isBandVisible", () => {
  test("a band inside the zoom is drawn", () => {
    expect(isBandVisible("00:45", ["00:30", "00:45"])).toBe(true);
  });

  test("a band the zoom excludes is not", () => {
    expect(isBandVisible("00:00", ["00:30", "00:45"])).toBe(false);
  });

  // The "now" marker is null on a curve that doesn't contain this instant —
  // tomorrow's, above all — and that is not a band at all.
  test("no band is not a visible band", () => {
    expect(isBandVisible(null, ["00:30"])).toBe(false);
    expect(isBandVisible(undefined, ["00:30"])).toBe(false);
  });
});
