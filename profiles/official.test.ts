import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { loadProfileWasm } from "../packages/sdk/src/index.ts";
import deyeSg01hp3 from "./deye-sg01hp3.ts";
import deyeSg01hp310k from "./deye-sg01hp3-10k.ts";
import deyeSg01hp312k from "./deye-sg01hp3-12k.ts";
import deyeSg01hp315k from "./deye-sg01hp3-15k.ts";
import deyeSg01hp320k from "./deye-sg01hp3-20k.ts";
import deyeSg01hp325k from "./deye-sg01hp3-25k.ts";
import deyeSg01hp35k from "./deye-sg01hp3-5k.ts";
import deyeSg01hp36k from "./deye-sg01hp3-6k.ts";
import deyeSg01hp38k from "./deye-sg01hp3-8k.ts";
import deyeSg05lp3 from "./deye-sg05lp3.ts";
import deyeSun10kSg05lp3 from "./deye-sun10k-sg05lp3.ts";
import deyeSun12kSg05lp3 from "./deye-sun12k-sg05lp3.ts";
import deyeSun14kSg05lp3 from "./deye-sun14k-sg05lp3.ts";
import deyeSun15kSg05lp3 from "./deye-sun15k-sg05lp3.ts";
import deyeSun16kSg05lp3 from "./deye-sun16k-sg05lp3.ts";
import deyeSun18kSg05lp3 from "./deye-sun18k-sg05lp3.ts";
import deyeSun20kSg05lp3 from "./deye-sun20k-sg05lp3.ts";
import deyeSun5kSg05lp3 from "./deye-sun5k-sg05lp3.ts";
import deyeSun6kSg05lp3 from "./deye-sun6k-sg05lp3.ts";
import deyeSun8kSg05lp3 from "./deye-sun8k-sg05lp3.ts";
import evcc from "./evcc.ts";
import sunspec from "./sunspec.ts";

/** Every official profile, by its source's file name. */
const official = {
  "deye-sg01hp3.ts": deyeSg01hp3,
  "deye-sg01hp3-10k.ts": deyeSg01hp310k,
  "deye-sg01hp3-12k.ts": deyeSg01hp312k,
  "deye-sg01hp3-15k.ts": deyeSg01hp315k,
  "deye-sg01hp3-20k.ts": deyeSg01hp320k,
  "deye-sg01hp3-25k.ts": deyeSg01hp325k,
  "deye-sg01hp3-5k.ts": deyeSg01hp35k,
  "deye-sg01hp3-6k.ts": deyeSg01hp36k,
  "deye-sg01hp3-8k.ts": deyeSg01hp38k,
  "deye-sg05lp3.ts": deyeSg05lp3,
  "deye-sun10k-sg05lp3.ts": deyeSun10kSg05lp3,
  "deye-sun12k-sg05lp3.ts": deyeSun12kSg05lp3,
  "deye-sun14k-sg05lp3.ts": deyeSun14kSg05lp3,
  "deye-sun15k-sg05lp3.ts": deyeSun15kSg05lp3,
  "deye-sun16k-sg05lp3.ts": deyeSun16kSg05lp3,
  "deye-sun18k-sg05lp3.ts": deyeSun18kSg05lp3,
  "deye-sun20k-sg05lp3.ts": deyeSun20kSg05lp3,
  "deye-sun5k-sg05lp3.ts": deyeSun5kSg05lp3,
  "deye-sun6k-sg05lp3.ts": deyeSun6kSg05lp3,
  "deye-sun8k-sg05lp3.ts": deyeSun8kSg05lp3,
  "evcc.ts": evcc,
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
