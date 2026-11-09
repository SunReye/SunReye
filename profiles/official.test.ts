import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { loadProfileWasm } from "../packages/sdk/src/index.ts";
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
