/**
 * THE CONTAINER on a real filesystem: does what `writeArchive` produced come
 * back out of `openArchive` byte for byte, and does a DAMAGED file get refused
 * instead of half-read?
 *
 * The corruption cases are the point. A backup file is read exactly once, on the
 * worst day someone has had all year, and the two ways it goes wrong quietly are
 * both here: a gzip stream whose tail was lost still decompresses to a plausible
 * prefix, and a tar member whose declared size outruns the file still yields
 * bytes if a reader does not check. Either would import a SHORT history and
 * report success.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import {
  ARCHIVE_FORMAT,
  MEMBERS,
  TAR_BLOCK,
  buildManifest,
  emptyStreamCounts,
  tarEnd,
  tarMember,
} from "./archive";
import { createLineSpool, indexTar, openArchive, writeArchive } from "./archive-file";

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "sunreye-archive-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const encoder = new TextEncoder();

const MANIFEST = buildManifest({
  createdAt: new Date("2026-08-27T10:00:00.000Z"),
  source: {
    app: "2.0.0",
    drizzleTag: "0001",
    drizzleWhen: 1,
    timescaleFiles: ["0000_baseline.sql"],
  },
  plantTimeZone: "Europe/Berlin",
  streams: { ...emptyStreamCounts(), raw: 2 },
  span: { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2026-08-02T00:00:00Z") },
  devices: ["deye-1"],
  metrics: ["pv.power"],
});

const manifestMember = () => ({
  name: MEMBERS.manifest,
  bytes: encoder.encode(JSON.stringify(MANIFEST)),
});

async function buildFixture(prefix: string, readingLines: readonly string[]) {
  const spoolPath = join(dir, `${prefix}-readings.gz`);
  const spool = createLineSpool(MEMBERS.readings, spoolPath);
  for (const line of readingLines) spool.write(line);
  const readings = await spool.close();
  const out = join(dir, `${prefix}.tar.gz`);
  const size = await writeArchive(out, [
    manifestMember(),
    { name: MEMBERS.config, bytes: encoder.encode(JSON.stringify({ appSettings: [] })) },
    readings,
  ]);
  return { out, size, readings };
}

describe("write then read", () => {
  test("every member comes back, and the readings stream line by line", async () => {
    const lines = ['{"n":1}', '{"n":2}', '{"n":3}'];
    const { out } = await buildFixture("round-trip", lines);
    const archive = await openArchive(out, join(dir, "work-round-trip"));
    try {
      expect(archive.manifest.format).toBe(ARCHIVE_FORMAT);
      expect(archive.manifest.streams.raw).toBe(2);
      expect(archive.config).toEqual({ appSettings: [] });
      expect(archive.members.map((m) => m.name)).toEqual([
        MEMBERS.manifest,
        MEMBERS.config,
        MEMBERS.readings,
      ]);
      const read: string[] = [];
      for await (const line of archive.lines(MEMBERS.readings)) read.push(line);
      expect(read).toEqual(lines);
    } finally {
      await archive.close();
    }
  });

  test("an EMPTY export is a valid archive that reads back as zero rows", async () => {
    const { out, size } = await buildFixture("empty", []);
    expect(size).toBeGreaterThan(0);
    const archive = await openArchive(out, join(dir, "work-empty"));
    try {
      const read: string[] = [];
      for await (const line of archive.lines(MEMBERS.readings)) read.push(line);
      expect(read).toEqual([]);
    } finally {
      await archive.close();
    }
  });

  test("a member the archive does not carry yields nothing rather than throwing", async () => {
    const { out } = await buildFixture("no-config-log", ['{"n":1}']);
    const archive = await openArchive(out, join(dir, "work-no-config-log"));
    try {
      const read: string[] = [];
      for await (const line of archive.lines(MEMBERS.configLog)) read.push(line);
      expect(read).toEqual([]);
    } finally {
      await archive.close();
    }
  });

  test("a line longer than one gzip chunk survives the split", async () => {
    // 4 MB on one line: the reader's carry buffer has to span several chunks.
    const long = `{"pad":"${"x".repeat(4 << 20)}"}`;
    const { out } = await buildFixture("long-line", [long, '{"n":2}']);
    const archive = await openArchive(out, join(dir, "work-long-line"));
    try {
      const read: string[] = [];
      for await (const line of archive.lines(MEMBERS.readings)) read.push(line);
      expect(read).toEqual([long, '{"n":2}']);
    } finally {
      await archive.close();
    }
  });

  test("a multi-byte character split across a chunk boundary is not mangled", async () => {
    // The decoder must be streaming; a per-chunk decode would emit U+FFFD here.
    const line = `{"label":"${"°ü→".repeat(200_000)}"}`;
    const { out } = await buildFixture("utf8", [line]);
    const archive = await openArchive(out, join(dir, "work-utf8"));
    try {
      const read: string[] = [];
      for await (const l of archive.lines(MEMBERS.readings)) read.push(l);
      expect(read).toEqual([line]);
      expect(read[0]).not.toContain("�");
    } finally {
      await archive.close();
    }
  });

  test("compression is real — the spool is far smaller than the lines it holds", async () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `{"metric_key":"pv.power","value":${i}}`);
    const raw = lines.reduce((sum, l) => sum + l.length + 1, 0);
    const { readings } = await buildFixture("ratio", lines);
    expect(readings.size).toBeLessThan(raw / 5);
    expect(readings.lines).toBe(5000);
  });
});

describe("a damaged archive is refused, never half-read", () => {
  test("a truncated gzip stream is named as corrupt", async () => {
    const { out } = await buildFixture(
      "truncated",
      Array.from({ length: 5000 }, (_, i) => `{"n":${i}}`),
    );
    const whole = await readFile(out);
    const cut = join(dir, "truncated-cut.tar.gz");
    await writeFile(cut, whole.subarray(0, Math.floor(whole.length / 2)));
    await expect(openArchive(cut, join(dir, "work-truncated"))).rejects.toThrow(
      /corrupt or truncated/,
    );
  });

  test("a file that is not gzip at all is refused", async () => {
    const notGzip = join(dir, "not-gzip.tar.gz");
    await writeFile(notGzip, "this is a text file, not an archive\n");
    await expect(openArchive(notGzip, join(dir, "work-not-gzip"))).rejects.toThrow(
      /not a readable gzip stream/,
    );
  });

  test("a valid gzip that is not a SunReye archive is refused by its missing manifest", async () => {
    const other = join(dir, "other.tar.gz");
    const tar = new Uint8Array([...tarMember("notes.txt", encoder.encode("hi")), ...tarEnd()]);
    await writeFile(other, gzipSync(tar));
    await expect(openArchive(other, join(dir, "work-other"))).rejects.toThrow(
      /not a SunReye archive/,
    );
  });

  test("a tar whose end-of-archive marker was lost is refused as truncated", async () => {
    const noEnd = join(dir, "no-end.tar");
    await writeFile(noEnd, tarMember(MEMBERS.manifest, encoder.encode("{}")));
    await expect(indexTar(noEnd)).rejects.toThrow(/end-of-archive/);
  });

  test("a member claiming more bytes than the file holds is refused, not read short", async () => {
    // The signature of a truncated download: the header survived, the body did not.
    const member = tarMember(MEMBERS.readings, new Uint8Array(TAR_BLOCK * 4));
    const short = join(dir, "short-body.tar");
    await writeFile(short, member.subarray(0, TAR_BLOCK + TAR_BLOCK));
    await expect(indexTar(short)).rejects.toThrow(/truncated/);
  });

  test("a NEWER format version is refused after one gzip pass, before any member is read", async () => {
    const spool = await (async () => {
      const s = createLineSpool(MEMBERS.readings, join(dir, "newer-readings.gz"));
      s.write('{"n":1}');
      return s.close();
    })();
    const newer = join(dir, "newer.tar.gz");
    await writeArchive(newer, [
      {
        name: MEMBERS.manifest,
        bytes: encoder.encode(JSON.stringify({ ...MANIFEST, formatVersion: 99 })),
      },
      spool,
    ]);
    await expect(openArchive(newer, join(dir, "work-newer"))).rejects.toThrow(/format version 99/);
  });
});

describe("the spool", () => {
  test("reports the lines it wrote and a real file size", async () => {
    const path = join(dir, "spool-count.gz");
    const spool = createLineSpool(MEMBERS.readings, path);
    for (let i = 0; i < 100; i++) spool.write(`{"i":${i}}`);
    expect(spool.lines).toBe(100);
    const member = await spool.close();
    expect(member.size).toBe((await stat(path)).size);
    expect(member.name).toBe(MEMBERS.readings);
  });

  test("an empty spool still produces a valid gzip member", async () => {
    const member = await createLineSpool(MEMBERS.configLog, join(dir, "spool-empty.gz")).close();
    expect(member.size).toBeGreaterThan(0);
    expect(member.lines).toBe(0);
  });
});
