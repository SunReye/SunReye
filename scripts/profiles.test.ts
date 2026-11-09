import { expect, test } from "bun:test";
import { copyFile, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProfiles } from "../packages/sdk/src/build.ts";
import { loadProfileWasm } from "../packages/sdk/src/index.ts";
import deye from "../profiles/deye-sg05lp3.ts";

const profiles = new URL("../profiles", import.meta.url).pathname;

test("the committed profile files and index are the build of profiles/", async () => {
  const out = await mkdtemp(join(tmpdir(), "profiles-"));
  const files = (await readdir(profiles)).filter((name) => name.endsWith(".json"));

  await Promise.all(files.map((name) => copyFile(join(profiles, name), join(out, name))));
  await buildProfiles(profiles, out);

  const built = await Promise.all(files.map((name) => readFile(join(out, name), "utf8")));
  const committed = await Promise.all(files.map((name) => readFile(join(profiles, name), "utf8")));

  expect(files).toContain("index.json");
  expect(built).toEqual(committed);
});

test("the official Deye profile loads without a warning", async () => {
  const wasm = await loadProfileWasm();

  expect(wasm.lint(JSON.stringify(deye))).toEqual([]);
});
