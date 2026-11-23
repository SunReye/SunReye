// Ready roofs (ADR 20): each placed in one click as the lines a person could have traced, then
// pulled up. Each test traces the roof by clicks alone and pulls it up, and the ready roof must be
// that roof.

import { expect, test } from "bun:test";
import {
  bent,
  markLine,
  moveLine,
  placeRoof,
  pullEaves,
  pullRidges,
  readyRoofs,
  setHeight,
} from "./index.js";
import { EMPTY, made, trace } from "./roof.harness.ts";
import { OUTLINE, SIZE, built, height, line, placed, point, zoomed } from "./roof-ready.harness.ts";

test("a Satteldach is its outline and a ridge along x, pulled up", () => {
  const traced = trace(trace(EMPTY, ...OUTLINE), [0, 4], [10, 4]);
  const clicked = made(pullRidges(made(pullEaves(traced, 0, 3)), 0, 7));

  expect(height(clicked, 0, 0)).toBe(3);
  expect(height(clicked, 10, 4)).toBe(7);
  expect(bent(clicked, 0)).toEqual([]);
  expect(built(placed("satteldach"))).toEqual(built(clicked));
  expect(built(clicked)).toHaveLength(2);
});

test("a Pultdach is its outline, its back edge made a ridge: its high side", () => {
  const traced = trace(EMPTY, ...OUTLINE);
  const marked = made(markLine(traced, 0, line(traced, [0, 0], [10, 0]), "ridge"));
  const clicked = made(pullRidges(made(pullEaves(marked, 0, 3)), 0, 7));

  expect(height(clicked, 10, 0)).toBe(7);
  expect(height(clicked, 10, 8)).toBe(3);
  expect(built(placed("pultdach"))).toEqual(built(clicked));
  expect(built(clicked)).toHaveLength(1);
});

test("a versetztes Pultdach is two mono-pitch roofs stepped by a strip 10 cm wide", () => {
  const traced = zoomed(zoomed(trace(EMPTY, ...OUTLINE), [0, 4], [10, 4]), [0, 4.1], [10, 4.1]);
  const pulled = made(pullRidges(made(pullEaves(traced, 0, 3)), 0, 7));
  const low = made(setHeight(pulled, 0, point(pulled, 0, 4.1), 3 + 8 / 3));
  const clicked = made(setHeight(low, 0, point(low, 10, 4.1), 3 + 8 / 3));

  expect(height(clicked, 0, 4)).toBe(7);
  expect(height(clicked, 10, 4.1)).toBeCloseTo(5.667, 3);
  expect(bent(clicked, 0)).toEqual([]);
  expect(built(placed("versetztes-pultdach"))).toEqual(built(clicked));
  expect(built(clicked)).toHaveLength(3);
});

test("a Flachdach is its outline pulled up to its eaves", () => {
  const clicked = made(pullEaves(trace(EMPTY, ...OUTLINE), 0, 3));

  expect(height(clicked, 10, 8)).toBe(3);
  expect(built(placed("flachdach"))).toEqual(built(clicked));
  expect(built(clicked)).toHaveLength(1);
});

test("a Flachdach with a parapet rings its roof with the parapet's top and inner wall", () => {
  const size = { ...SIZE, eave: 6, ridge: 6.5 };
  const mitred = zoomed(trace(EMPTY, ...OUTLINE), [0, 0], [0.3, 0.3], [9.7, 0.3], [10, 0]);

  const ringed = zoomed(
    zoomed(zoomed(mitred, [0, 8], [0.3, 7.7], [9.7, 7.7], [10, 8]), [0.3, 0.3], [0.3, 7.7]),
    [9.7, 0.3],
    [9.7, 7.7],
  );

  const traced = zoomed(ringed, [0.2, 0.2], [9.8, 0.2], [9.8, 7.8], [0.2, 7.8], [0.2, 0.2]);
  const outer = made(markLine(traced, 0, line(traced, [0, 0], [10, 0]), "ridge"));
  const both = made(markLine(outer, 0, line(outer, [0, 8], [10, 8]), "ridge"));
  const inner = made(markLine(both, 0, line(both, [0.3, 0.3], [9.7, 0.3]), "eave"));
  const marked = made(markLine(inner, 0, line(inner, [0.3, 7.7], [9.7, 7.7]), "eave"));
  const clicked = made(pullRidges(made(pullEaves(marked, 0, 6)), 0, 6.5));

  expect(height(clicked, 0, 0)).toBe(6.5);
  expect(height(clicked, 9.8, 7.8)).toBe(6.5);
  expect(height(clicked, 9.7, 7.7)).toBe(6);
  expect(bent(clicked, 0)).toEqual([]);
  expect(built(placed("flachdach-attika", size))).toEqual(built(clicked));
  expect(built(clicked)).toHaveLength(9);
});

test("a Schmetterlingsdach falls to a valley: its middle made an eave, its long sides ridges", () => {
  const traced = trace(trace(EMPTY, ...OUTLINE), [0, 4], [10, 4]);
  const valley = made(markLine(traced, 0, line(traced, [0, 4], [10, 4]), "eave"));
  const back = made(markLine(valley, 0, line(valley, [0, 0], [10, 0]), "ridge"));
  const marked = made(markLine(back, 0, line(back, [0, 8], [10, 8]), "ridge"));
  const clicked = made(pullRidges(made(pullEaves(marked, 0, 3)), 0, 7));

  expect(height(clicked, 0, 0)).toBe(7);
  expect(height(clicked, 10, 4)).toBe(3);
  expect(built(placed("schmetterlingsdach"))).toEqual(built(clicked));
  expect(built(clicked)).toHaveLength(2);
});

test("a Walmdach is its outline, a ridge along its longer side and a hip to each corner", () => {
  const hips = trace(trace(EMPTY, ...OUTLINE), [0, 0], [4, 4], [6, 4], [10, 0]);
  const traced = trace(trace(hips, [0, 8], [4, 4]), [6, 4], [10, 8]);
  const clicked = made(pullRidges(made(pullEaves(traced, 0, 3)), 0, 7));

  expect(height(clicked, 4, 4)).toBe(7);
  expect(bent(clicked, 0)).toEqual([]);
  expect(built(placed("walmdach"))).toEqual(built(clicked));
  expect(built(clicked)).toHaveLength(4);

  const deep = trace(EMPTY, [0, 0], [8, 0], [8, 10], [0, 10], [0, 0]);
  const deepHips = trace(trace(deep, [0, 0], [4, 4], [4, 6], [0, 10]), [8, 0], [4, 4]);

  const deepClicked = made(
    pullRidges(made(pullEaves(trace(deepHips, [4, 6], [8, 10]), 0, 3)), 0, 7),
  );

  expect(built(placed("walmdach", { ...SIZE, width: 8, depth: 10 }))).toEqual(built(deepClicked));
});

test("a Zeltdach is its outline and a hip from each corner to its middle", () => {
  const hips = trace(trace(EMPTY, ...OUTLINE), [0, 0], [5, 4], [10, 8]);
  const traced = trace(hips, [10, 0], [5, 4], [0, 8]);
  const clicked = made(pullRidges(made(pullEaves(traced, 0, 3)), 0, 7));

  expect(height(clicked, 5, 4)).toBe(7);
  expect(built(placed("zeltdach"))).toEqual(built(clicked));
  expect(built(placed("walmdach", { ...SIZE, depth: 10 }))).toEqual(
    built(placed("zeltdach", { ...SIZE, depth: 10 })),
  );
  expect(built(clicked)).toHaveLength(4);
});

test("the ready roofs are listed for a menu by id, in German and in English, and each places", () => {
  expect(readyRoofs.map(({ id, de }) => [id, de])).toEqual([
    ["satteldach", "Satteldach"],
    ["pultdach", "Pultdach"],
    ["versetztes-pultdach", "Versetztes Pultdach"],
    ["flachdach", "Flachdach"],
    ["flachdach-attika", "Flachdach mit Attika"],
    ["walmdach", "Walmdach"],
    ["krueppelwalmdach", "Krüppelwalmdach"],
    ["zeltdach", "Zeltdach"],
    ["mansarddach", "Mansarddach"],
    ["mansardwalmdach", "Mansardwalmdach"],
    ["schleppdach", "Schleppdach"],
    ["sheddach", "Sheddach"],
    ["schmetterlingsdach", "Schmetterlingsdach"],
    ["tonnendach", "Tonnendach"],
  ]);
  expect(readyRoofs.find(({ id }) => id === "satteldach")?.en).toBe("Gable roof");

  for (const { id } of readyRoofs) expect(bent(placed(id), 0)).toEqual([]);
});

test("a ready roof is a traced block of its own, moved to its corner, and edited by its lines", () => {
  const house = placed("satteldach");
  const edited = placeRoof(house, "pultdach", { x: 12, z: 0 }, { ...SIZE, width: 4 });

  if ("refused" in edited) throw new Error(edited.refused);

  expect(edited.block).toBe(1);
  expect(height(edited.scene, 12, 0, 1)).toBe(7);
  expect(height(edited.scene, 16, 8, 1)).toBe(3);

  const ridge = line(house, [0, 4], [10, 4]);
  const moved = made(moveLine(house, 0, ridge, { x: 0, z: 1 }));

  expect(height(moved, 0, 5)).toBe(7);
  expect(built(moved)).toHaveLength(2);
});

test("a ready roof is refused onto another traced roof, without a size, or by an id it does not know", () => {
  const house = placed("satteldach");

  expect(placeRoof(house, "flachdach", { x: 10, z: 0 }, SIZE)).toEqual({ refused: "joins" });
  expect(placeRoof(house, "flachdach", { x: 5, z: -2 }, SIZE)).toEqual({ refused: "joins" });
  expect(placeRoof(EMPTY, "flachdach", { x: 0, z: 0 }, { ...SIZE, width: 0 })).toEqual({
    refused: "short",
  });
  expect(placeRoof(EMPTY, "kuppel", { x: 0, z: 0 }, SIZE)).toEqual({ refused: "missing" });
});
