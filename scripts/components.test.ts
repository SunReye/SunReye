import { expect, test } from "bun:test";
import { deal } from "./components.ts";

const scene = (file: string, ms: number) => ({ file, ms, scene: true });
const dom = (file: string, ms: number) => ({ file, ms, scene: false });

test("the scene files, which run one at a time, are dealt by their time across the shards", () => {
  const shards = deal(
    [scene("a", 90), scene("b", 60), scene("c", 50), scene("d", 40), scene("e", 10)],
    2,
  );

  // 90 + 10 against 60 + 50 + 40 would be 100 / 150; dealt longest first it is 130 / 120.
  expect(shards).toEqual([
    ["a", "d"],
    ["b", "c", "e"],
  ]);
});

test("the other files are dealt by their time on their own, a tie to the shard with less scene", () => {
  const shards = deal([scene("s", 100), dom("x", 30), dom("y", 20), dom("z", 10)], 2);

  expect(shards).toEqual([["s", "y", "z"], ["x"]]);
});

test("more shards than files leaves the rest empty", () => {
  expect(deal([dom("x", 5), dom("y", 5)], 3)).toEqual([["x"], ["y"], []]);
});
