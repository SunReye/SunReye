import { expect, test } from "bun:test";
import { deal, mergeTimes, picked, shardCount } from "./components.ts";

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

test("the arguments before the first option pick the files whose path holds one of them", () => {
  const files = [
    "src/a/One.svelte.test.ts",
    "src/b/Two.svelte.test.ts",
    "src/b/Three.svelte.test.ts",
  ];

  expect(picked(files, ["src/b", "Three", "-t", "src/a", "--reporter=dot"])).toEqual({
    files: ["src/b/Two.svelte.test.ts", "src/b/Three.svelte.test.ts"],
    options: ["-t", "src/a", "--reporter=dot"],
    record: false,
    cache: false,
  });
});

test("no file filter keeps every file", () => {
  expect(picked(["x", "y"], ["--bail", "1"])).toEqual({
    files: ["x", "y"],
    options: ["--bail", "1"],
    record: false,
    cache: false,
  });
});

test("cached timings override recorded timings while keeping recorded entries for uncached files", () => {
  const recorded = {
    "a.svelte.test.ts": 4000,
    "b.svelte.test.ts": 1200,
  };

  const cached = {
    "b.svelte.test.ts": 1850,
    "c.svelte.test.ts": 900,
  };

  expect(mergeTimes(recorded, cached)).toEqual({
    "a.svelte.test.ts": 4000,
    "b.svelte.test.ts": 1850,
    "c.svelte.test.ts": 900,
  });
});

test("picked separates --record-timings and --cache from vitest options", () => {
  expect(
    picked(["src/a.svelte.test.ts"], ["src/a", "--record-timings", "--cache", "--reporter=dot"]),
  ).toEqual({
    files: ["src/a.svelte.test.ts"],
    options: ["--reporter=dot"],
    record: true,
    cache: true,
  });
  expect(picked(["src/a.svelte.test.ts"], []).cache).toBe(false);
});

test("the shard count is a whole number of at least one, else the run is refused", () => {
  expect(shardCount(undefined, 18)).toBe(6);
  expect(shardCount(undefined, 2)).toBe(1);
  expect(shardCount("4", 18)).toBe(4);

  for (const bad of ["0", "", "x", "2.5", "-1"]) expect(() => shardCount(bad, 18)).toThrow();
});
