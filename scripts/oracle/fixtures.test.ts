import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { CORPUS_DIR, staleFiles } from "./corpus";
import { decodeReadings, officialProfilesDir, type ProfileDecodeCase } from "./profile-decode";
import { discoverGenerators, readDocumentation } from "./registry";

const read = (path: string): Promise<string> => readFile(join(CORPUS_DIR, path), "utf8");
const lines = async (path: string): Promise<Array<Record<string, any>>> =>
  (await read(path))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

const profilesDir = officialProfilesDir();
const generators = await discoverGenerators();

describe("the committed corpus, database-free groups", () => {
  for (const { name, oracle } of generators) {
    test.skipIf(oracle.needsProfiles === true && profilesDir === null)(
      `${name} is what its generator produces now`,
      async () => {
        const files = await oracle.build({ profilesDir });
        expect(await staleFiles(files)).toEqual([]);
        expect([...new Set(Object.keys(files).map((path) => path.split("/")[0]))].sort()).toEqual(
          [...oracle.files].sort(),
        );
      },
      120_000,
    );
  }

  test("every profile decode line replays from the metric definitions it carries", async () => {
    const profiles = (await lines("profile-decode.ndjson")) as unknown as ProfileDecodeCase[];
    expect(profiles.length).toBeGreaterThan(0);
    for (const profile of profiles) {
      for (const c of profile.cases) {
        const regs: Record<number, number> = {};
        for (const run of c.runs) run.words.forEach((word, i) => (regs[run.start + i] = word));
        const replayed = decodeReadings(profile.metrics, regs);
        expect([profile.profile.id, c.name, replayed.readings]).toEqual([
          profile.profile.id,
          c.name,
          c.readings,
        ]);
        expect(replayed.clamped).toEqual(c.clamped);
      }
    }
  });

  test("every plant case names a stale member, a role one member lacks and a retired member", async () => {
    const cases = await lines("plant.ndjson");
    const live = cases.map((c) => c.plant.live);
    expect(live.some((l) => l.stale.length > 0 && l.members.length > l.stale.length)).toBe(true);
    const lacks = cases.some((c) => {
      const keys = Object.values(c.live.samples)
        .filter((s): s is { metrics: Record<string, number> } => s !== null)
        .map((s) => Object.keys(s.metrics).sort().join());
      return new Set(keys).size > 1;
    });
    expect(lacks).toBe(true);
    expect(
      cases.some((c) =>
        c.devices.some(
          (d: { slug: string; retiredAt: string | null }) =>
            d.retiredAt !== null &&
            c.members.history.includes(d.slug) &&
            !c.members.live.includes(d.slug),
        ),
      ),
    ).toBe(true);
  });
});

describe("the corpus as a whole", () => {
  test("every group exists", async () => {
    const files = new Set(await readdir(CORPUS_DIR, { recursive: true }));
    for (const path of [
      "transport.ndjson",
      "profile-decode.ndjson",
      "profile-manifest.ndjson",
      "role-kinds.ndjson",
      "rollups.ndjson",
      "statistics.ndjson",
      "forecast.ndjson",
      "role-aggregates.ndjson",
      "plant.ndjson",
      "plant-rollups.ndjson",
      "archives/current-2.x/archive.tar.gz",
      "archives/legacy-1.2.0/archive.tar.gz",
      "README.md",
    ]) {
      expect(files.has(path), path).toBe(true);
    }
  });

  test("every profile has a manifest line, in the decode file's order", async () => {
    const decoded = (await lines("profile-decode.ndjson")).map((p) => p.profile.id);
    const manifests = await lines("profile-manifest.ndjson");
    expect(manifests.map((m) => m.profile.id)).toEqual(decoded);
    expect(manifests.map((m) => m.profile.sha256)).toEqual(
      (await lines("profile-decode.ndjson")).map((p) => p.profile.sha256),
    );
  });

  test("the README lists every case", async () => {
    const readme = await readDocumentation(CORPUS_DIR);
    const names: string[] = [];
    for (const file of [
      "transport.ndjson",
      "rollups.ndjson",
      "statistics.ndjson",
      "forecast.ndjson",
      "plant.ndjson",
      "plant-rollups.ndjson",
    ]) {
      names.push(...(await lines(file)).map((c) => c.case));
    }
    names.push(...(await lines("profile-decode.ndjson")).map((p) => p.profile.id));
    names.push(...(await readdir(join(CORPUS_DIR, "archives"))));
    for (const name of names) expect(readme, name).toContain(`\`${name}\``);
  });
});
