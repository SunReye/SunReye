/**
 * THE ARCHIVE FORMAT, proved without a database.
 *
 * Everything in `./archive.ts` is a decision about a FILE that has to be readable
 * by a version of SunReye that does not exist yet, which makes each of these
 * assertions a compatibility promise rather than a unit test. The three that
 * matter most, and each has a silent failure mode:
 *
 *  1. A NEWER format version is REFUSED, loudly. An importer that guesses at a
 *     field it does not understand writes wrong history and reports success.
 *  2. `source_tier` survives the round trip. It is what tells the importer a row
 *     came from an hourly bucket rather than a poll, and dropping it turns a
 *     one-hour hold into a one-second one.
 *  3. Zero, negative and absent are three different things. `0` is a reading (a
 *     PV string at night), a negative value is a reading (export, discharge), and
 *     a missing one must be refused rather than defaulted.
 */
import { describe, expect, test } from "bun:test";

import {
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  MEMBERS,
  type ArchiveManifest,
  type ConfigLogRow,
  type ReadingRow,
  SOURCE_TIERS,
  TAR_BLOCK,
  buildManifest,
  decodeConfigLog,
  decodeReading,
  emptyStreamCounts,
  encodeConfigLog,
  encodeReading,
  manifestProblems,
  parseManifest,
  parseTarHeader,
  tarEnd,
  tarMember,
  tarPadding,
  unknownIdentities,
} from "./archive";

const READING: ReadingRow = {
  time: new Date("2026-07-28T12:34:00.000Z"),
  deviceSlug: "deye-1",
  metricKey: "total_energy",
  value: 64_280.971,
  durMs: 60_000,
  sourceTier: "minute",
};

const MANIFEST_INPUT = {
  createdAt: new Date("2026-08-27T10:00:00.000Z"),
  source: {
    app: "2.0.0",
    drizzleTag: "0001_mature_gunslinger",
    drizzleWhen: 1787854069079,
    timescaleFiles: ["0000_baseline.sql"],
  },
  plantTimeZone: "Europe/Berlin",
  streams: { raw: 3, minute: 2, hourly: 1, daily: 0, configLog: 4 },
  span: { from: new Date("2026-06-28T00:00:00.000Z"), to: new Date("2026-08-27T00:00:00.000Z") },
  devices: ["deye-1"],
  metrics: ["total_energy"],
};

describe("readings.ndjson rows", () => {
  test("a row round-trips through the line form under the documented field names", () => {
    const line = encodeReading(READING);
    // The field NAMES are the contract — a future reader parses these, not our types.
    expect(JSON.parse(line)).toEqual({
      time: "2026-07-28T12:34:00.000Z",
      device_slug: "deye-1",
      metric_key: "total_energy",
      value: 64_280.971,
      dur_ms: 60_000,
      source_tier: "minute",
    });
    expect(decodeReading(line, 1)).toEqual(READING);
  });

  test("a line never contains a newline, so the file stays line-delimited", () => {
    const line = encodeReading({ ...READING, deviceSlug: "weird\nslug", metricKey: "a\nb" });
    expect(line).not.toContain("\n");
    expect(decodeReading(line, 1)?.deviceSlug).toBe("weird\nslug");
  });

  test("every declared tier survives the round trip", () => {
    for (const tier of SOURCE_TIERS) {
      const row = { ...READING, sourceTier: tier };
      expect(decodeReading(encodeReading(row), 1)?.sourceTier).toBe(tier);
    }
  });

  test("zero and negative values are readings, not absences", () => {
    for (const value of [0, -0.0001, -4200]) {
      expect(decodeReading(encodeReading({ ...READING, value }), 1)?.value).toBe(value);
    }
  });

  test("a blank line is skipped rather than treated as a row", () => {
    expect(decodeReading("", 7)).toBeNull();
    expect(decodeReading("   \t ", 7)).toBeNull();
  });

  test("a missing value is refused, naming the line", () => {
    const line = JSON.stringify({
      time: READING.time.toISOString(),
      device_slug: "d",
      metric_key: "m",
      dur_ms: 1000,
      source_tier: "raw",
    });
    expect(() => decodeReading(line, 42)).toThrow(/line 42/);
  });

  test("an unparseable timestamp is refused rather than becoming the epoch", () => {
    const line = JSON.stringify({
      time: "not a date",
      device_slug: "d",
      metric_key: "m",
      value: 1,
      dur_ms: 1000,
      source_tier: "raw",
    });
    expect(() => decodeReading(line, 3)).toThrow(/line 3/);
  });

  test("an unknown source_tier is refused — guessing a bucket width is a wrong kWh figure", () => {
    const line = JSON.stringify({
      time: READING.time.toISOString(),
      device_slug: "d",
      metric_key: "m",
      value: 1,
      dur_ms: 1000,
      source_tier: "weekly",
    });
    expect(() => decodeReading(line, 9)).toThrow(/weekly/);
  });

  test("a null dur_ms is carried as null — metrics_raw allows it", () => {
    const row: ReadingRow = { ...READING, durMs: null, sourceTier: "raw" };
    expect(decodeReading(encodeReading(row), 1)).toEqual(row);
  });

  test("truncated JSON is refused with the line number", () => {
    expect(() => decodeReading('{"time":"2026', 5)).toThrow(/line 5/);
  });
});

describe("config-log.ndjson rows", () => {
  const row: ConfigLogRow = {
    time: new Date("2026-07-01T00:00:00.000Z"),
    deviceSlug: "deye-1",
    metricKey: "settings.grid_limit",
    value: 0,
  };

  test("round-trips, and zero is kept", () => {
    expect(JSON.parse(encodeConfigLog(row))).toEqual({
      time: "2026-07-01T00:00:00.000Z",
      device_slug: "deye-1",
      metric_key: "settings.grid_limit",
      value: 0,
    });
    expect(decodeConfigLog(encodeConfigLog(row), 1)).toEqual(row);
  });

  test("a blank line is skipped and a broken one is refused by line", () => {
    expect(decodeConfigLog("  ", 2)).toBeNull();
    expect(() => decodeConfigLog("{", 11)).toThrow(/line 11/);
  });
});

describe("manifest", () => {
  test("built manifests carry the format marker and this version", () => {
    const manifest = buildManifest(MANIFEST_INPUT);
    expect(manifest.format).toBe(ARCHIVE_FORMAT);
    expect(manifest.formatVersion).toBe(ARCHIVE_FORMAT_VERSION);
    expect(manifest.streams).toEqual(MANIFEST_INPUT.streams);
    expect(manifest.span).toEqual({
      from: "2026-06-28T00:00:00.000Z",
      to: "2026-08-27T00:00:00.000Z",
    });
    expect(manifest.rows).toBe(6);
  });

  test("an empty export is a valid manifest with a null span", () => {
    const manifest = buildManifest({
      ...MANIFEST_INPUT,
      streams: emptyStreamCounts(),
      span: { from: null, to: null },
      devices: [],
      metrics: [],
    });
    expect(manifest.rows).toBe(0);
    expect(manifest.span).toEqual({ from: null, to: null });
    expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  test("a manifest round-trips through JSON", () => {
    const manifest = buildManifest(MANIFEST_INPUT);
    expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  test("a NEWER format version is refused loudly, never guessed at", () => {
    const manifest = {
      ...buildManifest(MANIFEST_INPUT),
      formatVersion: ARCHIVE_FORMAT_VERSION + 1,
    };
    expect(() => parseManifest(JSON.stringify(manifest))).toThrow(
      new RegExp(
        `format version ${ARCHIVE_FORMAT_VERSION + 1}.*understands ${ARCHIVE_FORMAT_VERSION}`,
      ),
    );
  });

  test("an OLDER format version is accepted — the file is the migration vehicle", () => {
    // Version 1 is the first, so this asserts the RULE rather than a real older file.
    expect(manifestProblems({ ...buildManifest(MANIFEST_INPUT), formatVersion: 0 })).toEqual([]);
  });

  test("a file that is not a SunReye archive is refused by its marker", () => {
    expect(() => parseManifest(JSON.stringify({ formatVersion: 1, hello: "world" }))).toThrow(
      /not a SunReye archive/,
    );
  });

  test("unparseable manifest JSON is refused as a corrupt archive", () => {
    expect(() => parseManifest("{ not json")).toThrow(/manifest\.json/);
  });

  test("a manifest missing a required field is refused, naming it", () => {
    const { plantTimeZone: _omitted, ...rest } = buildManifest(MANIFEST_INPUT);
    expect(() => parseManifest(JSON.stringify(rest))).toThrow(/plantTimeZone/);
  });
});

describe("identity verification", () => {
  test("no unknowns when every slug and key is known", () => {
    expect(
      unknownIdentities(
        { devices: ["a", "b"], metrics: ["x"] },
        { devices: new Set(["a", "b", "c"]), metrics: new Set(["x", "y"]) },
      ),
    ).toEqual([]);
  });

  test("an unknown device slug is reported, not silently dropped", () => {
    const problems = unknownIdentities(
      { devices: ["ghost"], metrics: ["x"] },
      { devices: new Set(["a"]), metrics: new Set(["x"]) },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/device slug.*ghost/);
  });

  test("an unknown metric key is reported — a join that finds no match is silent data loss", () => {
    const problems = unknownIdentities(
      { devices: ["a"], metrics: ["mystery"] },
      { devices: new Set(["a"]), metrics: new Set(["x"]) },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/metric key.*mystery/);
  });

  test("both kinds are reported together, so one import run names every gap", () => {
    expect(
      unknownIdentities(
        { devices: ["g1", "g2"], metrics: ["m1"] },
        { devices: new Set(), metrics: new Set() },
      ),
    ).toHaveLength(3);
  });
});

describe("tar container", () => {
  const body = new TextEncoder().encode("hello archive");

  test("a member is a 512-byte header followed by the body padded to 512", () => {
    const member = tarMember(MEMBERS.manifest, body);
    expect(member.length).toBe(TAR_BLOCK * 2);
    expect(parseTarHeader(member.subarray(0, TAR_BLOCK))).toEqual({
      name: MEMBERS.manifest,
      size: body.length,
    });
  });

  test("the checksum is the one GNU tar validates", () => {
    const header = tarMember("x", body).subarray(0, TAR_BLOCK);
    // Recompute exactly as tar does: the checksum field itself counts as spaces.
    let sum = 0;
    for (let i = 0; i < TAR_BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : (header[i] as number);
    const raw = new TextDecoder().decode(header.subarray(148, 156));
    const stored = Number.parseInt(
      raw.slice(0, raw.indexOf("\0") === -1 ? raw.length : raw.indexOf("\0")),
      8,
    );
    expect(stored).toBe(sum);
  });

  test("a body that is already a multiple of 512 gets no padding", () => {
    expect(tarPadding(0)).toBe(0);
    expect(tarPadding(TAR_BLOCK)).toBe(0);
    expect(tarPadding(1)).toBe(TAR_BLOCK - 1);
    expect(tarPadding(TAR_BLOCK + 1)).toBe(TAR_BLOCK - 1);
  });

  test("the end marker is two zero blocks, which is what makes the file complete", () => {
    const end = tarEnd();
    expect(end.length).toBe(TAR_BLOCK * 2);
    expect(end.every((b) => b === 0)).toBe(true);
  });

  test("a zero block ends the walk rather than parsing as a member", () => {
    expect(parseTarHeader(new Uint8Array(TAR_BLOCK))).toBeNull();
  });

  test("a header whose checksum does not match is refused as corruption", () => {
    const header = tarMember("x", body).subarray(0, TAR_BLOCK).slice();
    header[0] = 0x41; // rename 'x' to 'A' without fixing the checksum
    expect(() => parseTarHeader(header)).toThrow(/checksum/);
  });

  test("a size that is not octal is refused rather than read as NaN bytes", () => {
    const header = tarMember("x", body).subarray(0, TAR_BLOCK).slice();
    // A size field of spaces: parses to NaN, and a reader that believed it would
    // slice `[offset, offset+NaN)` — an empty member, silently.
    header.set(new TextEncoder().encode("            "), 124);
    let sum = 0;
    for (let i = 0; i < TAR_BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : (header[i] as number);
    header.set(new TextEncoder().encode(`${sum.toString(8).padStart(6, "0")}\0 `), 148);
    expect(() => parseTarHeader(header)).toThrow(/size/);
  });

  test("every member name this format uses fits the 100-byte tar name field", () => {
    for (const name of Object.values(MEMBERS)) {
      expect(name.length).toBeLessThanOrEqual(100);
      expect(parseTarHeader(tarMember(name, body).subarray(0, TAR_BLOCK))?.name).toBe(name);
    }
  });

  test("a name too long for the field is refused rather than truncated", () => {
    expect(() => tarMember("x".repeat(101), body)).toThrow(/name/);
  });
});

describe("the members a v1 archive holds", () => {
  test("exactly four, and no auth table among them", () => {
    expect(Object.values(MEMBERS)).toEqual([
      "manifest.json",
      "config.json",
      "config-log.ndjson.gz",
      "readings.ndjson.gz",
    ]);
    // Password hashes and sessions are a liability in a portable file. Deliberate.
    for (const name of Object.values(MEMBERS)) {
      expect(name).not.toMatch(/user|session|account|apikey|auth/);
    }
  });
});

const _typecheck: ArchiveManifest = buildManifest(MANIFEST_INPUT);
void _typecheck;
