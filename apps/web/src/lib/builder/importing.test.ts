/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { SurroundingsStatus } from "../api/core.ts";
import { centreOf, fetched, type Source } from "./importing.ts";
import type { Imported } from "./imported.ts";

const ID = "ab".repeat(32);

const DOCUMENT: Imported = {
  radius: 200,
  buildings: [],
  trees: [],
  hedges: [],
  grounds: [],
  terrain: { step: 5, side: 1, heights: [0] },
  credits: ["© OpenStreetMap contributors"],
};

/** A core whose status answers `statuses` one after another, the last for ever. */
function core(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the core's own answer.
  first: SurroundingsStatus | { readonly problem: string },
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the core's own answers.
  statuses: readonly SurroundingsStatus[],
) {
  const calls: string[] = [];
  let polls = 0;

  const source: Source = {
    loadSurroundings: (load) => {
      calls.push(`load ${JSON.stringify(load)}`);

      return Promise.resolve(first);
    },
    surroundingsStatus: () => {
      const status = statuses[Math.min(polls, statuses.length - 1)] ?? { state: "idle" };

      polls += 1;
      calls.push("status");

      return Promise.resolve(status);
    },
    surroundings: (id) => {
      calls.push(`document ${id}`);

      return Promise.resolve(DOCUMENT);
    },
  };

  return { source, calls };
}

const now = (): Promise<void> => Promise.resolve();

test("a load polls the status until the document is ready, then reads it", async () => {
  const { source, calls } = core({ state: "fetching" }, [
    { state: "fetching" },
    { state: "ready", document: ID },
  ]);

  expect(await fetched(source, { radius: 200 }, now)).toEqual({ id: ID, document: DOCUMENT });
  expect(calls).toEqual(['load {"radius":200}', "status", "status", `document ${ID}`]);
});

test("a refused load says the core's code and polls nothing", async () => {
  const { source, calls } = core({ problem: "surroundings.location" }, []);

  expect(await fetched(source, { radius: 200 }, now)).toEqual({
    problem: "surroundings.location",
  });
  expect(calls).toHaveLength(1);
});

test("a failed fetch says the core's reason", async () => {
  const { source } = core({ state: "fetching" }, [
    { state: "failed", error: "overpass: 504", document: ID },
  ]);

  expect(await fetched(source, { radius: 100 }, now)).toEqual({ reason: "overpass: 504" });
});

test("a centre is both numbers within the globe, none when both are empty, else refused", () => {
  expect(centreOf("48,137", " 11.575 ")).toEqual({ latitude: 48.137, longitude: 11.575 });
  expect(centreOf("", " ")).toBeUndefined();
  expect(centreOf("48.1", "")).toBeNull();
  expect(centreOf("91", "11")).toBeNull();
  expect(centreOf("48", "181")).toBeNull();
  expect(centreOf("north", "11")).toBeNull();
});
