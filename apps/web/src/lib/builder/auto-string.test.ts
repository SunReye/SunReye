/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { StringDraft } from "../api/core.ts";
import { autoStrung, type Limit } from "./auto-string.ts";
import { addGrid, type Draft } from "@sunreye/builder/builder/modules.ts";
import { place } from "@sunreye/builder/builder/placing.ts";
import type { Scene } from "@sunreye/builder/builder/pv.ts";
import { wiredInto } from "@sunreye/builder/builder/selecting.ts";

const block = {
  x: 0,
  z: 0,
  width: 10,
  depth: 8,
  eave: 3,
  rotation: 0,
  roof: { kind: "gable", pitch: 35 },
} as const;

const bare: Scene = { north: 0, blocks: [block], obstacles: [], grids: [] };

/** Two rows of eight portrait modules from the setback's corner: 0–7 below, 8–15 above. */
const spots = Array.from({ length: 16 }, (_, i) => ({
  across: 0.3 + (i % 8) * 1.154,
  up: 0.3 + Math.floor(i / 8) * 1.742,
  landscape: false,
}));

const scene = place(addGrid(bare, 0, 1, 7), 0, spots);

const first: StringDraft = {
  name: "Garage",
  moduleType: 7,
  device: 1,
  input: 1,
  modules: 0,
  optimized: 0,
  tilt: 0,
  azimuth: 0,
  loss: 3,
};

const draft: Draft = { scene, strings: [first] };
const name = (number: number) => `String ${String(number)}`;

/** Free inputs that all share one limit. */
const even = (longest: number | null, free: readonly number[], parallel: number | null): Limit => ({
  device: 1,
  free: free.map((input) => ({ input, longest, parallel })),
});

/** The modules of string `string` in their wiring order, by their position in the grid. */
function run(of: Draft | null, string: number): number[] {
  const modules = of?.scene.grids?.[0]?.modules ?? [];

  return modules
    .flatMap((module, at) => (module.string === string ? [[module.order ?? -1, at] as const] : []))
    .toSorted((a, b) => a[0] - b[0])
    .map(([, at]) => at);
}

/** Each new string's input and its modules in wiring order. */
const made = (of: Draft | undefined) =>
  (of?.strings ?? []).slice(1).map((string, i) => [string.input, run(of ?? null, i + 1)]);

const strung = (limit: Limit, from: Draft = draft) => {
  const result = autoStrung(from, 0, limit, name);

  return result !== null && "draft" in result ? result : undefined;
};

test("with an input free for each, a face's modules run in a serpentine into as few even strings as the limit allows", () => {
  const result = strung(even(6, [2, 3, 4], 2));

  // 16 modules at most 6 long: three strings of 6, 5 and 5, each alone on its input.
  expect(made(result?.draft)).toEqual([
    [2, [0, 1, 2, 3, 4, 5]],
    [3, [6, 7, 15, 14, 13]],
    [4, [12, 11, 10, 9, 8]],
  ]);
  expect(result?.left).toBe(0);
  expect(result?.draft.strings[1]).toEqual({ ...first, name: "String 2", input: 2 });
});

test("strings that share an input are all one length: the fewest that leave no module over", () => {
  const result = strung(even(6, [2, 3], 2));

  // Three strings would be 6, 5 and 5 with two in parallel: four of four share the two inputs.
  expect(made(result?.draft)).toEqual([
    [2, [0, 1, 2, 3]],
    [2, [4, 5, 6, 7]],
    [3, [15, 14, 13, 12]],
    [3, [11, 10, 9, 8]],
  ]);
  expect(result?.left).toBe(0);
});

test("where no equal cut holds every module the rest stays unwired, and is counted", () => {
  const partly = wiredInto(draft, [{ grid: 0, module: 3 }], 0) ?? draft;
  // 15 modules at most 7 long on one input that carries two strings: two of seven, one over.
  const result = strung(even(7, [2], 2), partly);

  expect(made(result?.draft)).toEqual([
    [2, [0, 1, 2, 4, 5, 6, 7]],
    [2, [15, 14, 13, 12, 11, 10, 9]],
  ]);
  expect(result?.left).toBe(1);
  // The wired module stays as it is.
  expect(run(result?.draft ?? null, 0)).toEqual([3]);
});

test("without a limit the face is one string; no free input, no proposal; none unwired, nothing", () => {
  const whole = strung(even(null, [2], null));

  expect(made(whole?.draft)).toEqual([[2, [0, 1, 2, 3, 4, 5, 6, 7, 15, 14, 13, 12, 11, 10, 9, 8]]]);
  expect(autoStrung(draft, 0, even(6, [], 2), name)).toEqual({
    refused: "input",
  });
  expect(whole && autoStrung(whole.draft, 0, even(6, [3], 2), name)).toBeNull();
});

test("each free input is sized by its own limits: a short window takes a shorter string", () => {
  const result = strung({
    device: 1,
    free: [
      { input: 2, longest: 6, parallel: 1 },
      { input: 3, longest: 10, parallel: 1 },
    ],
  });

  expect(made(result?.draft)).toEqual([
    [2, [0, 1, 2, 3, 4, 5]],
    [3, [6, 7, 15, 14, 13, 12, 11, 10, 9, 8]],
  ]);
  expect(result?.left).toBe(0);
});

test("an input carries no more strings in parallel than its own current allows", () => {
  const result = strung({
    device: 1,
    free: [
      { input: 2, longest: 6, parallel: 2 },
      { input: 3, longest: 6, parallel: 1 },
    ],
  });

  // Four of four would put two on input 3: three of five fit, and one module stays over.
  expect(result?.draft.strings.slice(1).map(({ input }) => input)).toEqual([2, 2, 3]);
  expect([1, 2, 3].map((string) => run(result?.draft ?? null, string).length)).toEqual([5, 5, 5]);
  expect(result?.left).toBe(1);
});
