import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildProfileDecodeCorpus,
  decodeReadings,
  loadProfiles,
  officialProfilesDir,
  type ProfileDecodeCase,
  type SlimMetric,
} from "./profile-decode";

const SAMPLE = new URL(
  "../../packages/profile-sdk/src/__fixtures__/sample-profile.json",
  import.meta.url,
).pathname;

const metric = (m: Partial<SlimMetric> & Pick<SlimMetric, "key">): SlimMetric => ({
  via: "modbus",
  type: "U_WORD",
  addr: [],
  scale: 1,
  ...m,
});

describe("decodeReadings", () => {
  const metrics: SlimMetric[] = [
    metric({ key: "v", addr: [10], scale: 0.1 }),
    metric({ key: "p", type: "S_WORD", addr: [11] }),
    metric({ key: "e", type: "U_DWORD", addr: [12, 13], scale: 0.1 }),
    metric({ key: "t", type: "S_WORD", addr: [14], scale: 0.1, offset: -100 }),
    metric({ key: "soc", addr: [15], range: { min: 0, max: 100 } }),
    metric({ key: "gone", addr: [99] }),
    metric({ key: "sum", via: "compute", expr: { sum: ["v", "soc"] } }),
    metric({ key: "ratio", via: "compute", expr: { ratio: { num: ["v"], den: ["gone"] } } }),
  ];

  // Expected values are worked by hand: 2305 * 0.1, 0xFC18 = -1000, (1 << 16 | 0x1234) * 0.1,
  // 1500 * 0.1 - 100, and a raw 0xFFFF clamped to the declared 100.
  const regs = { 10: 2305, 11: 0xfc18, 12: 0x1234, 13: 1, 14: 1500, 15: 0xffff };

  test("scale, sign, low-word-first double word, offset", () => {
    const { readings } = decodeReadings(metrics, regs);
    expect(readings.v).toBe(230.5);
    expect(readings.p).toBe(-1000);
    expect(readings.e).toBeCloseTo(7019.6, 10);
    expect(readings.t).toBe(50);
  });

  test("a value outside its declared range is clamped and the clamp is reported", () => {
    const { readings, clamped } = decodeReadings(metrics, regs);
    expect(readings.soc).toBe(100);
    expect(clamped).toEqual({ soc: 65535 });
  });

  test("an unanswered register is absent, never zero", () => {
    expect(decodeReadings(metrics, regs).readings).not.toHaveProperty("gone");
  });

  test("a double word with one word missing is absent", () => {
    expect(decodeReadings(metrics, { 12: 5 }).readings).not.toHaveProperty("e");
  });

  test("computed metrics run over what was read; a zero denominator reads 0", () => {
    const { readings } = decodeReadings(metrics, regs);
    expect(readings.sum).toBe(330.5);
    expect(readings.ratio).toBe(0);
  });

  test("two calls do not share clamp history", () => {
    decodeReadings(metrics, regs);
    expect(decodeReadings(metrics, { 15: 50 }).clamped).toEqual({});
  });
});

describe("official profile discovery", () => {
  test("SUNREYE_PROFILES_DIR wins when it holds an index.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oracle-discovery-"));
    await writeFile(join(dir, "index.json"), "{}");
    expect(officialProfilesDir({ SUNREYE_PROFILES_DIR: dir })).toBe(dir);
    await rm(dir, { recursive: true, force: true });
  });

  test("a directory without an index.json is no profiles directory", () => {
    expect(officialProfilesDir({ SUNREYE_PROFILES_DIR: tmpdir() })).toBeNull();
  });

  test("a directory that does not exist is no directory", () => {
    expect(
      officialProfilesDir({ SUNREYE_PROFILES_DIR: "/nonexistent/oracle-profiles" }),
    ).toBeNull();
  });
});

describe("a profiles directory", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "oracle-profiles-"));
    await mkdir(join(dir, "profiles"));
    await copyFile(SAMPLE, join(dir, "profiles", "b.json"));
    await copyFile(SAMPLE, join(dir, "profiles", "a.json"));
    const entry = (id: string) => ({
      id,
      name: id,
      manufacturer: "Deye",
      version: "1.0.17",
      path: `profiles/${id}.json`,
    });
    await writeFile(
      join(dir, "index.json"),
      JSON.stringify({ profiles: [entry("b"), entry("a")] }),
    );
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  test("loads every indexed profile, ordered by id, with the file's sha256", async () => {
    const loaded = await loadProfiles(dir);
    expect(loaded.map((p) => p.entry.id)).toEqual(["a", "b"]);
    const expected = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(SAMPLE).bytes())
      .digest("hex");
    expect(loaded[0]!.sha256).toBe(expected);
  });

  test("a missing profile file fails loudly", async () => {
    const broken = await mkdtemp(join(tmpdir(), "oracle-profiles-broken-"));
    await writeFile(
      join(broken, "index.json"),
      JSON.stringify({
        profiles: [
          { id: "x", name: "x", manufacturer: "m", version: "1", path: "profiles/x.json" },
        ],
      }),
    );
    await expect(loadProfiles(broken)).rejects.toThrow();
    await rm(broken, { recursive: true, force: true });
  });

  describe("the corpus built from it", () => {
    let cases: ProfileDecodeCase[];
    let text: string;
    beforeAll(async () => {
      text = String((await buildProfileDecodeCorpus(dir))["profile-decode.ndjson"]);
      cases = text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as ProfileDecodeCase);
    });

    test("one line per profile", () => {
      expect(cases.map((c) => c.profile.id)).toEqual(["a", "b"]);
    });

    test("is byte-identical when built twice", async () => {
      expect(String((await buildProfileDecodeCorpus(dir))["profile-decode.ndjson"])).toBe(text);
    });

    test("names the cases that pin sign, width, clamps and absence", () => {
      expect(cases[0]!.cases.map((c) => c.name)).toEqual([
        "zeros",
        "ramp",
        "all-ones",
        "sign-bit",
        "first-block-absent",
        "double-word-split",
      ]);
    });

    test("the register blocks are the planned reads, and the cases answer them", () => {
      const first = cases[0]!;
      expect(first.blocks.length).toBeGreaterThan(1);
      const ramp = first.cases.find((c) => c.name === "ramp")!;
      expect(ramp.runs.map((r) => [r.start, r.words.length])).toEqual(
        first.blocks.map((b) => [b.start, b.count]),
      );
    });

    test("a profile's readings replay from the embedded metric definitions alone", () => {
      for (const profile of cases) {
        for (const c of profile.cases) {
          const regs: Record<number, number> = {};
          for (const run of c.runs) run.words.forEach((w, i) => (regs[run.start + i] = w));
          expect(decodeReadings(profile.metrics, regs).readings).toEqual(c.readings);
        }
      }
    });

    test("all-ones: a signed word reads -1 and a double word reads 2^32 - 1, scaled", () => {
      const all = cases[0]!.cases.find((c) => c.name === "all-ones")!;
      expect(all.readings["ac.total_power"]).toBe(-1);
      expect(all.readings["total_energy"]).toBeCloseTo(429496729.5, 6);
    });

    test("an absent block leaves its metrics out rather than zero", () => {
      const absent = cases[0]!.cases.find((c) => c.name === "first-block-absent")!;
      const ramp = cases[0]!.cases.find((c) => c.name === "ramp")!;
      expect(Object.keys(absent.readings).length).toBeLessThan(Object.keys(ramp.readings).length);
    });
  });
});
