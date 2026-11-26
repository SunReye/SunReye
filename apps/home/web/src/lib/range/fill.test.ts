import { expect, test } from "bun:test";
import { bandsOf, intervals, spread } from "./fill.ts";
import type { Edge } from "./edges.ts";

const H = 3_600_000;

test("a value spreads over a window by the share of its span inside it", () => {
  const items = [
    { start: 0, end: 2 * H, v: 10 },
    { start: 2 * H, end: 4 * H, v: 20 },
  ];

  expect(spread(items, H, 3 * H, (i: Readonly<{ v: number }>) => i.v)).toEqual({
    sum: 15,
    covered: 2 * H,
  });
  expect(spread(items, 5 * H, 6 * H, (i: Readonly<{ v: number }>) => i.v)).toEqual({
    sum: 0,
    covered: 0,
  });
});

test("instants become spans reaching the next one, the last as long as the one before", () => {
  expect(
    intervals(
      [
        { at: 0, v: 1 },
        { at: H, v: 2 },
        { at: 3 * H, v: 3 },
      ],
      (p: Readonly<{ at: number }>) => p.at,
    ),
  ).toEqual([
    { start: 0, end: H, item: { at: 0, v: 1 } },
    { start: H, end: 3 * H, item: { at: H, v: 2 } },
    { start: 3 * H, end: 5 * H, item: { at: 3 * H, v: 3 } },
  ]);
});

const edge = (key: string, state: Edge["state"]): Edge => ({
  key,
  t0: 0,
  t1: 1,
  label: key,
  tick: true,
  title: key,
  state,
  drill: null,
});

test("a band without readings is a gap, one still to come is future, a thin one partial", () => {
  const bands = bandsOf(
    [edge("a", "past"), edge("b", "past"), edge("c", "live"), edge("d", "future")],
    (_: Edge, i: number) =>
      [
        { up: [1], down: [], covered: 0.5, elapsed: 1 },
        { up: [], down: [], covered: 0, elapsed: 1 },
        { up: [2], down: [], covered: 0.5, elapsed: 1 },
        { up: [], down: [], covered: 0, elapsed: 0 },
      ][i]!,
  );

  expect(bands.map((b) => [b.state, b.partial, b.drillable])).toEqual([
    ["data", true, false],
    ["gap", false, false],
    ["live", false, false],
    ["future", false, false],
  ]);
  expect(bands[1]!.up).toEqual([]);
});
