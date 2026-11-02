import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { CORPUS_DIR, staleFiles } from "./corpus";
import {
  buildProfileDecodeCorpus,
  decodeReadings,
  officialProfilesDir,
  type ProfileDecodeCase,
} from "./profile-decode";
import { buildTransportCorpus } from "./transport";

const read = (path: string): Promise<string> => readFile(join(CORPUS_DIR, path), "utf8");
const lines = async (path: string): Promise<Array<Record<string, any>>> =>
  (await read(path))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

describe("the committed corpus, database-free groups", () => {
  test("transport framing is what the 2.x transport produces now", async () => {
    expect(await staleFiles(await buildTransportCorpus())).toEqual([]);
  }, 120_000);

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

  const dir = officialProfilesDir();
  test.skipIf(dir === null)(
    "profile decode is what the profile repository produces now",
    async () => {
      expect(await staleFiles(await buildProfileDecodeCorpus(dir!))).toEqual([]);
    },
  );
});

describe("the corpus as a whole", () => {
  test("all five groups exist", async () => {
    const files = new Set(await readdir(CORPUS_DIR, { recursive: true }));
    for (const path of [
      "transport.ndjson",
      "profile-decode.ndjson",
      "profile-manifest.ndjson",
      "role-kinds.ndjson",
      "rollups.ndjson",
      "statistics.ndjson",
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
    const readme = await read("README.md");
    const names: string[] = [];
    for (const file of ["transport.ndjson", "rollups.ndjson", "statistics.ndjson"]) {
      names.push(...(await lines(file)).map((c) => c.case));
    }
    names.push(...(await lines("profile-decode.ndjson")).map((p) => p.profile.id));
    names.push(...(await readdir(join(CORPUS_DIR, "archives"))));
    for (const name of names) expect(readme, name).toContain(`\`${name}\``);
  });
});
