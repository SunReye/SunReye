import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { buildProfiles } from "./build.ts";
import type { Frozen } from "./define.ts";

const meter = {
  schema: 1,
  id: "meter",
  name: "Meter",
  manufacturer: "Test",
  version: "1.0.0",
  requires: ["modbus", "u16"],
  quantities: [{ key: "power", role: "grid.power", register: 10, type: "u16" }],
};

type Meter = typeof meter;

async function source(dir: string, profile: Frozen<Meter>): Promise<void> {
  await writeFile(join(dir, "meter.ts"), `export default ${JSON.stringify(profile)};\n`);
}

async function versionIn(dir: string): Promise<string> {
  const file: unknown = JSON.parse(await readFile(join(dir, "meter.json"), "utf8"));

  return file instanceof Object && "version" in file ? String(file.version) : "";
}

test("a new profile renders at its source version and lists in the index by its file's hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profiles-"));

  await source(dir, meter);
  await buildProfiles(dir, dir);

  const bytes = await readFile(join(dir, "meter.json"));
  const index: unknown = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));

  expect(JSON.parse(bytes.toString())).toEqual(meter);
  expect(index).toEqual({
    profiles: [
      {
        id: "meter",
        version: "1.0.0",
        schema: 1,
        requires: ["modbus", "u16"],
        sha256: createHash("sha256").update(bytes).digest("hex"),
        url: "meter.json",
      },
    ],
  });
});

/** A directory holding `profile` as source and `published` as its last build. */
async function built(profile: Frozen<Meter>, published: Frozen<Meter>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "profiles-"));

  await source(dir, profile);
  await writeFile(join(dir, "meter.json"), JSON.stringify(published));
  await buildProfiles(dir, dir);

  return dir;
}

test("a profile whose content is unchanged keeps its published version", async () => {
  const dir = await built(meter, { ...meter, version: "1.0.3" });

  expect(await versionIn(dir)).toBe("1.0.3");
});

test("a profile whose content changed bumps its published patch version", async () => {
  const dir = await built({ ...meter, name: "Meter 2" }, { ...meter, version: "1.4.9" });

  expect(await versionIn(dir)).toBe("1.4.10");
});

test("a source version above the published one is the author's bump", async () => {
  const dir = await built({ ...meter, version: "2.0.0" }, { ...meter, version: "1.4.9" });

  expect(await versionIn(dir)).toBe("2.0.0");
});

test("versions order by number, not by text", async () => {
  const dir = await built({ ...meter, version: "10.0.0" }, { ...meter, version: "9.0.0" });

  expect(await versionIn(dir)).toBe("10.0.0");
});

test("a profile the core would refuse fails the build with the loader's reason", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profiles-"));

  await source(dir, { ...meter, schema: 2 });

  let refused = "";

  try {
    await buildProfiles(dir, dir);
  } catch (error) {
    refused = String(error);
  }

  expect(refused).toContain("schema 2 is not supported");
});

test("the build reports each profile's version and the loader's warnings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profiles-"));
  const wide = { key: "energy", role: "grid.energy", register: 20, type: "u32" };

  await source(dir, { ...meter, quantities: [...meter.quantities, wide] });

  expect(await buildProfiles(dir, dir)).toEqual([
    {
      id: "meter",
      version: "1.0.0",
      warnings: ["`requires` lacks `u32`, which the profile uses"],
    },
  ]);
});

test("a directory relative to the working directory builds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "profiles-"));

  await source(dir, meter);

  expect(await buildProfiles(relative(process.cwd(), dir), dir)).toEqual([
    { id: "meter", version: "1.0.0", warnings: [] },
  ]);
});
