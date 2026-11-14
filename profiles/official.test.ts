import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { loadProfileWasm } from "../packages/sdk/src/index.ts";
import deyeSg01hp3 from "./deye-sg01hp3.ts";
import deyeSg05lp3 from "./deye-sg05lp3.ts";
import evcc from "./evcc.ts";
import shellyPro3em from "./shelly-pro-3em.ts";
import sunspec from "./sunspec.ts";

/** Every official profile, by its source's file name. */
const official = {
  "deye-sg01hp3.ts": deyeSg01hp3,
  "deye-sg05lp3.ts": deyeSg05lp3,
  "evcc.ts": evcc,
  "shelly-pro-3em.ts": shellyPro3em,
  "sunspec.ts": sunspec,
};

test("every profile source is listed as official", async () => {
  const sources = (await readdir(import.meta.dir)).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );

  expect(sources.toSorted()).toEqual(Object.keys(official).toSorted());
});

test.each(Object.entries(official))(
  "the official profile %s loads without a warning",
  async (_, profile) => {
    const wasm = await loadProfileWasm();

    expect(wasm.lint(JSON.stringify(profile))).toEqual([]);
  },
);
