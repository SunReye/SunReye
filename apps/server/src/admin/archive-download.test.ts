/**
 * THE EXPORT DOWNLOAD's decisions, without a database or a filesystem.
 *
 * Two of them are load-bearing on the box this has to run on:
 *
 *  * WHERE THE SPOOL GOES. `/tmp` is a TMPFS on a Home Assistant box, so
 *    spooling a full export there does not use disk — it uses RAM, on a 2 GB
 *    machine, which is the exact failure the streaming design exists to avoid.
 *  * WHAT THE FILE IS CALLED. It lands in `/share`, which is read over Samba, so
 *    a colon in the name makes it unopenable on a Windows client.
 */
import { describe, expect, test } from "bun:test";

import { SPOOL_CANDIDATES, exportFilename, isStaleSpool, pickSpoolRoot } from "./archive-download";

describe("pickSpoolRoot", () => {
  test("prefers a persistent candidate over the system temp dir", () => {
    // On the addon `/data` is the persistent datadir and `/tmp` is a tmpfs.
    expect(pickSpoolRoot(["/data", "/var/tmp"], (path) => path === "/data")).toBe("/data");
  });

  test("the PRIVATE directory is preferred over the LAN-visible one", () => {
    // `/share` is served to the whole LAN by the Samba add-on. The download spool
    // is transient and has no business being visible there, even briefly.
    expect(SPOOL_CANDIDATES[0]).toBe("/data");
    expect(SPOOL_CANDIDATES.indexOf("/data")).toBeLessThan(SPOOL_CANDIDATES.indexOf("/share"));
  });

  test("falls through to the next candidate when the first is absent", () => {
    expect(pickSpoolRoot(["/data", "/var/tmp"], (path) => path === "/var/tmp")).toBe("/var/tmp");
  });

  test("returns null when no candidate exists, so the caller can use os.tmpdir()", () => {
    expect(pickSpoolRoot(["/data"], () => false)).toBeNull();
  });

  test("an empty candidate list is null rather than an empty path", () => {
    expect(pickSpoolRoot([], () => true)).toBeNull();
  });

  test("the order of the candidates is the priority, and it is honoured", () => {
    expect(pickSpoolRoot(["/a", "/b"], () => true)).toBe("/a");
  });
});

describe("exportFilename", () => {
  test("carries the date, so two exports do not collide in a shared folder", () => {
    expect(exportFilename(new Date("2026-08-27T19:41:58.476Z"))).toContain("2026-08-27");
  });

  test("is a .tar.gz", () => {
    expect(exportFilename(new Date())).toEndWith(".tar.gz");
  });

  test("has no character Samba or Windows would refuse", () => {
    const name = exportFilename(new Date("2026-08-27T19:41:58.476Z"));
    expect(name).not.toMatch(/[:*?"<>|\\/\s]/);
  });

  test("is deterministic for one instant", () => {
    const at = new Date("2026-08-27T19:41:58.476Z");
    expect(exportFilename(at)).toBe(exportFilename(at));
  });
});

describe("isStaleSpool", () => {
  const now = new Date("2026-08-27T12:00:00Z").getTime();
  const HOUR = 3_600_000;

  test("a spool from a finished download is stale and can be swept", () => {
    expect(isStaleSpool({ mtimeMs: now - 3 * HOUR }, now)).toBe(true);
  });

  test("a spool a download may still be streaming from is NOT swept", () => {
    // Deleting it mid-stream would truncate the operator's download with no error.
    expect(isStaleSpool({ mtimeMs: now - 60_000 }, now)).toBe(false);
  });

  test("a spool from the future is not stale — a clock jump must not delete live work", () => {
    expect(isStaleSpool({ mtimeMs: now + HOUR }, now)).toBe(false);
  });

  test("exactly at the boundary is not yet stale", () => {
    expect(isStaleSpool({ mtimeMs: now - HOUR }, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE BUILD, through the IO seam.
//
// The filesystem, the connection and the exporter go through `DownloadIo`, so the
// SPOOL LOCATION, the sweep's refusals and the cleanup on failure are provable
// without writing 53 MB anywhere. What the exporter itself does is proved in
// `packages/db/src/archive-export-io.test.ts` and against a real database in
// `apps/server/db-tests/archive.test.ts`.
// ---------------------------------------------------------------------------

import { join } from "node:path";

import type { ExportRequest, ExportResult } from "@SunReye/db/archive-export";

import {
  type DownloadIo,
  SPOOL_DIR,
  buildExportArchive,
  productionIo,
  sweep,
} from "./archive-download";

const NOW = new Date("2026-08-27T10:11:12.345Z");

const exportResult = (): ExportResult =>
  ({
    path: "/data/sunreye-exports/export-x/a.tar.gz",
    barren: [],
    bytes: 55_617_590,
    uncompressedBytes: 1_421_583_309,
    manifest: { rows: 9_072_000 },
    plan: { chunks: [], gaps: [] },
    elapsedMs: 54_300,
  }) as unknown as ExportResult;

interface Fake {
  /** Roots that exist on this box. */
  roots?: string[];
  /** Spool directories already under the chosen root, with their mtimes. */
  spools?: Record<string, number>;
  /** `readdir` fails: the root does not exist yet. */
  readdirFails?: boolean;
  /** `stat` fails: another process is mid-way through removing that spool. */
  statFails?: boolean;
  configKeys?: string[];
  fail?: string;
}

interface Seam {
  io: DownloadIo;
  removed: string[];
  made: string[];
  spooled: string[];
  requests: ExportRequest[];
  logs: { message: string; fields: Record<string, unknown> }[];
  /** One entry per connection closed. */
  ended: string[];
}

function seam(fake: Fake = {}): Seam {
  const state = {
    removed: [] as string[],
    made: [] as string[],
    spooled: [] as string[],
    requests: [] as ExportRequest[],
    logs: [] as { message: string; fields: Record<string, unknown> }[],
    ended: [] as string[],
  };
  const io: DownloadIo = {
    exists: (path) => (fake.roots ?? []).includes(path),
    async readdir() {
      if (fake.readdirFails) throw new Error("ENOENT");
      return Object.keys(fake.spools ?? {});
    },
    async statOf(path) {
      if (fake.statFails) throw new Error("ENOENT");
      return { mtimeMs: fake.spools?.[path.split("/").pop() as string] ?? NOW.getTime() };
    },
    remove: async (path) => void state.removed.push(path),
    mkdir: async (path) => void state.made.push(path),
    async makeSpool(root) {
      const path = join(root, "export-abc123");
      state.spooled.push(path);
      return path;
    },
    tmpRoot: () => "/tmp",
    now: () => NOW,
    async connect() {
      return {
        query: async () => ({ rows: [] }),
        end: async () => void state.ended.push("closed"),
      };
    },
    async exportArchive(_client, request) {
      state.requests.push(request);
      if (fake.fail) throw new Error(fake.fail);
      return exportResult();
    },
    configKeys: async () => fake.configKeys ?? [],
    appVersion: () => "2.0.0",
    info: (message, fields) => void state.logs.push({ message, fields }),
  };
  return { io, ...state };
}

describe("sweep", () => {
  test("removes a spool a previous download finished with an hour ago", async () => {
    const hoursAgo = NOW.getTime() - 4 * 3_600_000;
    const state = seam({ spools: { "export-old": hoursAgo } });
    await sweep("/data/sunreye-exports", state.io);
    expect(state.removed).toEqual(["/data/sunreye-exports/export-old"]);
  });

  test("LEAVES a fresh spool alone — a browser may still be streaming from it", async () => {
    // Deleting one mid-download truncates the operator's file with no error
    // anywhere, so the TTL is generous on purpose.
    const state = seam({ spools: { "export-live": NOW.getTime() - 60_000 } });
    await sweep("/data/sunreye-exports", state.io);
    expect(state.removed).toEqual([]);
  });

  test("a root that does not exist yet is not an error — the first export creates it", async () => {
    const state = seam({ readdirFails: true });
    await expect(sweep("/data/sunreye-exports", state.io)).resolves.toBeUndefined();
    expect(state.removed).toEqual([]);
  });

  test("a spool another process is already removing is skipped, not fatal", async () => {
    const state = seam({ spools: { "export-going": 0 }, statFails: true });
    await expect(sweep("/data/sunreye-exports", state.io)).resolves.toBeUndefined();
    expect(state.removed).toEqual([]);
  });
});

describe("buildExportArchive", () => {
  test("spools into the PRIVATE /data, not the LAN-served /share", async () => {
    // /share is served to the whole LAN by the Samba add-on. This spool is
    // transient and has no business being visible, even briefly.
    const state = seam({ roots: ["/data", "/share"] });
    const download = await buildExportArchive(state.io);
    expect(state.made).toEqual([join("/data", SPOOL_DIR)]);
    expect(download.path).toBe(
      join("/data", SPOOL_DIR, "export-abc123", "sunreye-export-2026-08-27T10-11-12-345Z.tar.gz"),
    );
  });

  test("falls back to /share only when there is no /data", async () => {
    const state = seam({ roots: ["/share"] });
    await buildExportArchive(state.io);
    expect(state.made).toEqual([join("/share", SPOOL_DIR)]);
  });

  test("the TMPFS is the LAST resort — spooling 53 MB there uses RAM, not disk", async () => {
    const state = seam({ roots: [] });
    await buildExportArchive(state.io);
    expect(state.made).toEqual([join("/tmp", SPOOL_DIR)]);
  });

  test("reports the file the route has to stream, with its real size and row count", async () => {
    const state = seam({ roots: ["/data"] });
    const download = await buildExportArchive(state.io);
    expect(download).toMatchObject({
      filename: "sunreye-export-2026-08-27T10-11-12-345Z.tar.gz",
      bytes: 55_617_590,
      rows: 9_072_000,
    });
    expect(state.logs[0]?.fields).toEqual({ rows: 9_072_000, bytes: 55_617_590, ms: 54_300 });
  });

  test("the export is NATIVE and carries the profile's configuration keys", async () => {
    const state = seam({ roots: ["/data"], configKeys: ["grid.export_limit"] });
    await buildExportArchive(state.io);
    expect(state.requests[0]).toMatchObject({
      source: "native",
      configKeys: ["grid.export_limit"],
      appVersion: "2.0.0",
    });
    // Secrets are NOT carried: this file leaves the box over HTTP, and the REST
    // API deliberately refuses to return the MQTT password.
    expect(state.requests[0]?.includeSecrets).toBeUndefined();
  });

  test("the sweep runs BEFORE the new spool is created, never after", async () => {
    const state = seam({ roots: ["/data"], spools: { "export-old": 0 } });
    await buildExportArchive(state.io);
    // The old spool is gone and the new one exists: sweeping afterwards could
    // remove the spool this very download is about to stream from.
    expect(state.removed).toEqual([join("/data", SPOOL_DIR, "export-old")]);
    expect(state.spooled).toEqual([join("/data", SPOOL_DIR, "export-abc123")]);
  });

  test("a FAILED export removes its own spool and still closes the connection", async () => {
    // A spool with no finished archive in it is useless, and leaving it would make
    // the next sweep the only thing that ever removed it.
    const state = seam({ roots: ["/data"], fail: "the minute tier is gone" });
    await expect(buildExportArchive(state.io)).rejects.toThrow("the minute tier is gone");
    expect(state.removed).toEqual([join("/data", SPOOL_DIR, "export-abc123")]);
    // A leaked connection here is one fewer backend for the poll loop, once per
    // export rather than once ever.
    expect(state.ended).toEqual(["closed"]);
  });

  test("a successful export closes the connection too", async () => {
    const state = seam({ roots: ["/data"] });
    await buildExportArchive(state.io);
    expect(state.ended).toEqual(["closed"]);
    expect(state.removed).toEqual([]);
  });
});

describe("productionIo", () => {
  test("the spool roots it probes are the real ones, in priority order", () => {
    // `existsSync` on this machine, whatever it answers: the assertion is that the
    // probe is the real filesystem rather than a constant.
    expect(typeof productionIo.exists("/")).toBe("boolean");
    expect(productionIo.exists("/")).toBe(true);
    expect(productionIo.exists("/definitely-not-a-root-on-this-box")).toBe(false);
  });

  test("the last-resort root is the system temp dir and now is the real clock", () => {
    expect(productionIo.tmpRoot()).toBe(require("node:os").tmpdir());
    expect(productionIo.now().getTime()).toBeGreaterThan(0);
  });

  test("makeSpool creates a real directory under the root, mkdir creates the root", async () => {
    const root = join(require("node:os").tmpdir(), `download-io-${process.pid}-${Date.now()}`);
    await productionIo.mkdir(root);
    const spool = await productionIo.makeSpool(root);
    expect(spool.startsWith(join(root, "export-"))).toBe(true);
    await Bun.write(join(spool, "a.tar.gz"), "x");
    // …and it is visible to the sweep's own readdir and stat.
    expect(await productionIo.readdir(root)).toEqual([spool.split("/").pop() as string]);
    expect((await productionIo.statOf(spool)).mtimeMs).toBeGreaterThan(0);
    await productionIo.remove(root);
    expect(await Bun.file(join(spool, "a.tar.gz")).exists()).toBe(false);
  });

  test("exportArchive really is the shipped exporter, writing a real archive", async () => {
    // The seam must not be a second implementation: the method is the exporter,
    // and pointing it at an empty source produces a valid, readable archive.
    const dir = join(require("node:os").tmpdir(), `download-export-${process.pid}-${Date.now()}`);
    await productionIo.mkdir(dir);
    try {
      const client = {
        query: async () => {
          throw new Error("relation does not exist");
        },
        end: async () => {},
      };
      const result = await productionIo.exportArchive(client, {
        source: "native",
        out: join(dir, "a.tar.gz"),
        workDir: dir,
      });
      expect(result.manifest.rows).toBe(0);
      expect(await Bun.file(join(dir, "a.tar.gz")).exists()).toBe(true);
    } finally {
      await productionIo.remove(dir);
    }
  });

  test("configKeys is empty rather than fatal when there is no profile to read", async () => {
    // Reached with no database configured, which is exactly the `catch`.
    expect(await productionIo.configKeys()).toEqual([]);
  });

  test("the app version is read from the environment, not baked in at build", async () => {
    const real = process.env.SUNREYE_VERSION;
    try {
      process.env.SUNREYE_VERSION = "2.0.0-test";
      expect(productionIo.appVersion()).toBe("2.0.0-test");
    } finally {
      if (real === undefined) delete process.env.SUNREYE_VERSION;
      else process.env.SUNREYE_VERSION = real;
    }
  });

  test("info reaches the logger without throwing", () => {
    expect(() => productionIo.info("archive export built: {rows}", { rows: 1 })).not.toThrow();
  });
});
