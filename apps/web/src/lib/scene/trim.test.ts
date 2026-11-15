/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { Face } from "../builder/pv.ts";
import { edges } from "./trim.ts";

/** A gable roof over 10 × 8 m: eaves at 3 m along east–west, the ridge at 5 m. */
const gable: Face[] = [
  {
    surface: "roof",
    colour: "#9c4a32",
    corners: [
      [0, 0, 3],
      [10, 0, 3],
      [10, 4, 5],
      [0, 4, 5],
    ],
  },
  {
    surface: "roof",
    colour: "#9c4a32",
    corners: [
      [10, 8, 3],
      [0, 8, 3],
      [0, 4, 5],
      [10, 4, 5],
    ],
  },
];

test("a gable roof has one ridge, where its faces meet, in the roof's colour", () => {
  const { ridges } = edges(gable);

  expect(ridges).toHaveLength(1);
  expect(ridges[0]?.colour).toBe("#9c4a32");
  expect(
    [ridges[0]?.from, ridges[0]?.to].toSorted((a, b) => (a?.[0] ?? 0) - (b?.[0] ?? 0)),
  ).toEqual([
    [0, 4, 5],
    [10, 4, 5],
  ]);
});

test("a gutter runs along each eave: a face's level, lowest edge; its sloping edges are verges", () => {
  const { eaves, verges } = edges(gable);

  expect(eaves).toHaveLength(2);
  expect(eaves.every(({ from, to }) => from[2] === 3 && to[2] === 3)).toBe(true);
  expect(verges).toHaveLength(4);
  expect(verges.every(({ from, to }) => from[2] !== to[2])).toBe(true);
});

test("a flat roof and a wall have neither", () => {
  const flat: Face[] = [
    {
      surface: "roof",
      corners: [
        [0, 0, 3],
        [10, 0, 3],
        [10, 8, 3],
        [0, 8, 3],
      ],
    },
    {
      surface: "wall",
      corners: [
        [0, 0, 0],
        [10, 0, 0],
        [10, 0, 3],
        [0, 0, 3],
      ],
    },
  ];

  expect(edges(flat)).toEqual({ ridges: [], eaves: [], verges: [] });
});
