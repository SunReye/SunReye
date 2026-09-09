/**
 * THE `sunreye export` / `sunreye import` ARGUMENT SURFACE.
 *
 * A CLI is where a wrong default becomes an operator's bad afternoon, and two of
 * the decisions here are load-bearing:
 *
 *  * THE SUBCOMMAND NAMES MUST NOT COLLIDE WITH ANY FLAG. `apps/server/src/main.ts`
 *    routes on a bare `process.argv.includes("export")`, so a flag named
 *    `--export` anywhere — or a subcommand called `healthcheck` — would silently
 *    reroute a server boot into a data export. That is checked here rather than
 *    left to reading.
 *  * `--legacy` IS A SOURCE SELECTION, NOT A HINT. Reading a 1.2.0 database as if
 *    it were 2.0.0 finds no `devices` table and exports nothing, successfully. So
 *    the source is DETECTED from the schema, and the flag only overrides.
 */
import { describe, expect, test } from "bun:test";

import {
  ARCHIVE_SUBCOMMANDS,
  EXPORT_HELP,
  KNOWN_FLAGS,
  defaultArchiveName,
  parseDeviceMap,
  parseExportArgs,
  parseImportArgs,
  sourceForShape,
} from "./archive-cli";

describe("the subcommand names are safe for main.ts's bare argv.includes", () => {
  test("no subcommand starts with a dash", () => {
    for (const name of ARCHIVE_SUBCOMMANDS) expect(name).not.toStartWith("-");
  });

  test("no subcommand collides with a flag the binary already understands", () => {
    // `main.ts` does `process.argv.includes("export")` on the WHOLE argv, so a
    // collision would reroute a normal boot.
    for (const name of ARCHIVE_SUBCOMMANDS) {
      expect(KNOWN_FLAGS).not.toContain(name);
      expect(KNOWN_FLAGS).not.toContain(`--${name}`);
    }
  });

  test("the subcommands are distinct from each other and from `migrate`", () => {
    expect(new Set(ARCHIVE_SUBCOMMANDS).size).toBe(ARCHIVE_SUBCOMMANDS.length);
    expect(ARCHIVE_SUBCOMMANDS).not.toContain("migrate");
  });
});

describe("sourceForShape", () => {
  test("a database with a devices table is read as 2.0.0", () => {
    expect(sourceForShape({ hasDevices: true }, undefined)).toBe("native");
  });

  test("a database WITHOUT a devices table is read as 1.x, never as an empty 2.0.0", () => {
    // The failure this prevents: a native read of a 1.2.0 database joins `devices`,
    // finds nothing, and writes a perfectly valid archive containing no history.
    expect(sourceForShape({ hasDevices: false }, undefined)).toBe("legacy");
  });

  test("an explicit choice always wins over detection", () => {
    expect(sourceForShape({ hasDevices: true }, "legacy")).toBe("legacy");
    expect(sourceForShape({ hasDevices: false }, "native")).toBe("native");
  });
});

describe("parseExportArgs", () => {
  test("no arguments is a full export to a dated default name", () => {
    const options = parseExportArgs([]);
    expect(options.tiers).toBeUndefined();
    expect(options.source).toBeUndefined();
    expect(options.out).toBeNull();
  });

  test("--out names the file", () => {
    expect(parseExportArgs(["export", "--out", "/share/x.tar.gz"]).out).toBe("/share/x.tar.gz");
  });

  test("--legacy and --native select the source", () => {
    expect(parseExportArgs(["--legacy"]).source).toBe("legacy");
    expect(parseExportArgs(["--native"]).source).toBe("native");
  });

  test("--tiers narrows the sources, and the order is kept (finest first matters)", () => {
    expect(parseExportArgs(["--tiers", "raw,minute"]).tiers).toEqual(["raw", "minute"]);
  });

  test("an unknown tier is refused rather than silently ignored", () => {
    // Silently ignoring it would export less history than the operator asked for.
    expect(() => parseExportArgs(["--tiers", "weekly"])).toThrow(/weekly/);
  });

  test("--tiers with nothing after it is refused", () => {
    expect(() => parseExportArgs(["--tiers"])).toThrow(/--tiers/);
  });

  test("--out with nothing after it is refused rather than writing to the empty path", () => {
    expect(() => parseExportArgs(["--out"])).toThrow(/--out/);
  });

  test("an unrecognised flag is refused — a typo must not become a full-history default", () => {
    expect(() => parseExportArgs(["--tier", "raw"])).toThrow(/--tier/);
  });

  test("secrets are OFF by default and only an explicit flag turns them on", () => {
    // The MQTT password is stored in plaintext and the REST API refuses to return
    // it; an export that carried it by default would be a credential leak into a
    // file designed to be copied around.
    expect(parseExportArgs([]).includeSecrets).toBe(false);
    expect(parseExportArgs(["--tiers", "raw"]).includeSecrets).toBe(false);
    expect(parseExportArgs(["--include-secrets"]).includeSecrets).toBe(true);
  });

  test("the help text warns what --include-secrets does", () => {
    expect(EXPORT_HELP).toMatch(/--include-secrets/);
    expect(EXPORT_HELP).toMatch(/credential|LAN|Samba/);
  });
});

describe("parseImportArgs", () => {
  test("a bare path is the file", () => {
    expect(parseImportArgs(["import", "/share/x.tar.gz"]).file).toBe("/share/x.tar.gz");
  });

  test("--file names it too", () => {
    expect(parseImportArgs(["--file", "/share/x.tar.gz"]).file).toBe("/share/x.tar.gz");
  });

  test("no file at all is refused", () => {
    expect(() => parseImportArgs([])).toThrow(/file/i);
  });

  test("the subcommand word is not mistaken for the file", () => {
    expect(() => parseImportArgs(["import"])).toThrow(/file/i);
  });

  test("--force and --no-refresh are off by default", () => {
    const options = parseImportArgs(["/x.tar.gz"]);
    expect(options.force).toBe(false);
    expect(options.refresh).toBe(true);
  });

  test("--force is opt-in and nothing else turns it on", () => {
    expect(parseImportArgs(["/x.tar.gz", "--force"]).force).toBe(true);
  });

  test("--no-refresh turns the manual aggregate refresh OFF, and that is the dangerous one", () => {
    // Without the refresh the hypertable is full and every chart is empty, because
    // the refresh POLICIES only reach three hours back. It has to be explicit.
    expect(parseImportArgs(["/x.tar.gz", "--no-refresh"]).refresh).toBe(false);
  });

  test("--device-map builds the rename table", () => {
    expect(parseImportArgs(["/x", "--device-map", "old=new,a=b"]).deviceMap).toEqual({
      old: "new",
      a: "b",
    });
  });

  test("an unrecognised flag is refused", () => {
    expect(() => parseImportArgs(["/x", "--forse"])).toThrow(/--forse/);
  });
});

describe("parseDeviceMap", () => {
  test("empty input is an empty map", () => {
    expect(parseDeviceMap("")).toEqual({});
  });

  test("a single pair", () => {
    expect(parseDeviceMap("a=b")).toEqual({ a: "b" });
  });

  test("whitespace around the pairs is tolerated", () => {
    expect(parseDeviceMap(" a = b , c=d ")).toEqual({ a: "b", c: "d" });
  });

  test("a pair with no '=' is refused rather than dropped", () => {
    // Dropping it would import under the ORIGINAL slug, which is the outcome the
    // operator was trying to avoid.
    expect(() => parseDeviceMap("a=b,oops")).toThrow(/oops/);
  });

  test("an empty side is refused", () => {
    expect(() => parseDeviceMap("=b")).toThrow();
    expect(() => parseDeviceMap("a=")).toThrow();
  });
});

describe("defaultArchiveName", () => {
  test("carries the date so two exports do not overwrite each other", () => {
    const name = defaultArchiveName(new Date("2026-08-27T19:41:58.476Z"));
    expect(name).toContain("2026-08-27");
    expect(name).toEndWith(".tar.gz");
  });

  test("has no colon or space — it has to survive Samba and a Windows share", () => {
    const name = defaultArchiveName(new Date("2026-08-27T19:41:58.476Z"));
    expect(name).not.toMatch(/[:\s]/);
  });

  test("two exports in the same second still differ by nothing — the date is the contract", () => {
    const at = new Date("2026-08-27T19:41:58.476Z");
    expect(defaultArchiveName(at)).toBe(defaultArchiveName(at));
  });
});

// ---------------------------------------------------------------------------
// THE COMMANDS, through the IO seam.
//
// Every connection, module load, scratch directory and line of output goes
// through `ArchiveCliIo`, so what each command DOES — detect the schema, read the
// vocabulary from the profile, close the connection, remove the scratch, turn a
// refusal into an exit code — is provable here. What a real statement does is
// not, and is not claimed to be: `apps/server/db-tests/archive.test.ts` runs the
// statements and `scripts/archive-round-trip.ts` runs the whole loop.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ExportResult } from "@SunReye/db/archive-export";
import type { ImportResult } from "@SunReye/db/archive-import";

import {
  type ArchiveCliIo,
  type CliClient,
  IMPORT_HELP,
  productionIo,
  profileVocabulary,
  readShape,
  runArchiveCommand,
  routeSubcommand,
  runExport,
  runImport,
} from "./archive-cli";

const MANIFEST = {
  format: "sunreye-archive",
  formatVersion: 1,
  createdAt: "2026-08-27T10:00:00.000Z",
  source: { app: "2.0.0", drizzleTag: null, drizzleWhen: null, timescaleFiles: [] },
  plantTimeZone: "Europe/Berlin",
  streams: { raw: 10, minute: 0, hourly: 0, daily: 0, configLog: 2 },
  rows: 10,
  span: { from: "2026-08-20T00:00:00.000Z", to: "2026-08-21T00:00:00.000Z" },
  devices: ["deye-1"],
  metrics: ["pv.power"],
};

const exportResult = (over: Partial<ExportResult> = {}): ExportResult =>
  ({
    path: "/tmp/out.tar.gz",
    barren: [],
    bytes: 2 * 1024 * 1024,
    uncompressedBytes: 20 * 1024 * 1024,
    manifest: MANIFEST,
    plan: { chunks: [], gaps: [] },
    elapsedMs: 1200,
    ...over,
  }) as ExportResult;

const importResult = (over: Partial<ImportResult> = {}): ImportResult =>
  ({
    manifest: MANIFEST,
    inserted: { raw: 10, minute: 0, hourly: 0, daily: 0, configLog: 2 },
    replays: [],
    problems: [],
    skipped: null,
    elapsedMs: 900,
    ...over,
  }) as ImportResult;

interface Seam {
  io: ArchiveCliIo;
  out: string[];
  warnings: string[];
  errors: string[];
  connected: string[];
  ended: number[];
  removed: string[];
  exports: Record<string, unknown>[];
  imports: Record<string, unknown>[];
}

interface Fake {
  /** `to_regclass('public.devices')` — the 2.0.0 spine, or not. */
  hasDevices?: boolean;
  /** `installed_profiles` rows, newest first. */
  profiles?: { id: string; data: unknown }[];
  /** Statements this database cannot answer at all. */
  absent?: RegExp;
  exported?: ExportResult;
  imported?: ImportResult;
  /** Make the exporter or importer throw, as a real refusal would. */
  fail?: string;
}

function seam(fake: Fake = {}): Seam {
  const state: Omit<Seam, "io"> = {
    out: [],
    warnings: [],
    errors: [],
    connected: [],
    ended: [],
    removed: [],
    exports: [],
    imports: [],
  };
  const client: CliClient = {
    async query(text) {
      if (fake.absent?.test(text)) throw new Error("relation does not exist");
      if (text.includes("to_regclass")) return { rows: [{ present: fake.hasDevices === true }] };
      if (text.includes("installed_profiles")) return { rows: fake.profiles ?? [] };
      return { rows: [] };
    },
    async end() {
      state.ended.push(state.ended.length);
    },
  };
  const io: ArchiveCliIo = {
    async connect(url) {
      state.connected.push(url);
      return client;
    },
    async archiveModules() {
      return {
        async exportArchive(_client, request) {
          state.exports.push(request as unknown as Record<string, unknown>);
          if (fake.fail) throw new Error(fake.fail);
          return fake.exported ?? exportResult();
        },
        async importArchive(_client, request) {
          state.imports.push(request as unknown as Record<string, unknown>);
          if (fake.fail) throw new Error(fake.fail);
          return fake.imported ?? importResult();
        },
        defaultWorkDir: (file) => `${file}.work`,
      };
    },
    async profileHelpers() {
      return {
        statedKind: (metric) => (metric as { kind?: string }).kind ?? "instant",
        resolveStorage: (metric) => (metric as { storage?: string }).storage ?? "series",
        unwrapSetting: (value) => (typeof value === "string" ? JSON.parse(value) : value),
      };
    },
    makeWorkDir: async () => "/tmp/work-dir",
    remove: async (path) => void state.removed.push(path),
    now: () => new Date("2026-08-27T10:11:12.345Z"),
    cwd: () => "/data",
    log: (message) => void state.out.push(message),
    warn: (message) => void state.warnings.push(message),
    error: (message) => void state.errors.push(message),
  };
  return { io, ...state };
}

const clientOf = (fake: Fake): Promise<CliClient> => seam(fake).io.connect("postgres://x/y");

describe("routeSubcommand", () => {
  test("routes the two subcommand words, wherever in argv they appear", () => {
    expect(routeSubcommand(["node", "main.js", "export"])).toBe("export");
    expect(routeSubcommand(["import", "/share/a.tar.gz"])).toBe("import");
  });

  test("a plain server boot routes NOTHING", () => {
    expect(routeSubcommand(["node", "main.js"])).toBeNull();
    expect(routeSubcommand([])).toBeNull();
  });

  test("a PATH containing the word does not trigger it — whole elements only", () => {
    // A worktree called `w-export` on the argv would otherwise turn a server boot
    // into a data export.
    expect(routeSubcommand(["/home/dev/w-export/main.js", "--healthcheck"])).toBeNull();
    expect(routeSubcommand(["--out", "/share/export/a.tar.gz"])).toBeNull();
  });

  test("export wins when both words are present, rather than doing something clever", () => {
    expect(routeSubcommand(["import", "export"])).toBe("export");
  });
});

describe("an export takes no bare argument", () => {
  test("a stray positional is REFUSED, not read as the output path", () => {
    // `--out` is the flag. A bare path would otherwise be silently ignored and the
    // archive would land on the dated default, somewhere the operator did not look.
    expect(() => parseExportArgs(["/share/mine.tar.gz"])).toThrow(
      /unexpected argument \/share\/mine\.tar\.gz/,
    );
  });
});

describe("readShape", () => {
  test("a 2.0.0 database HAS the dimension spine", async () => {
    expect(await readShape(await clientOf({ hasDevices: true }))).toEqual({ hasDevices: true });
  });

  test("a 1.x database does not — and that is what makes the export legacy", async () => {
    // A native read of a 1.2.0 database joins `devices`, finds no such table, and
    // produces a perfectly valid archive containing no history at all.
    expect(await readShape(await clientOf({}))).toEqual({ hasDevices: false });
  });
});

describe("profileVocabulary", () => {
  const io = seam().io;

  test("the counter class comes from the profile's statedKind, never from a name", async () => {
    // `is_counter` is what puts `counter_agg` on the right series. Defaulting it
    // to false makes every energy total a naive max-minus-min: 64280.971 kWh
    // against a truth of 41.971 on the real fixture.
    const client = await clientOf({
      profiles: [
        {
          id: "row-id",
          data: {
            id: "deye.sun-12k",
            metrics: [
              { key: "total.energy", kind: "cumulative" },
              { key: "pv.power", kind: "instant" },
              { key: "grid.export_limit", kind: "instant", storage: "config" },
            ],
          },
        },
      ],
    });
    expect(await profileVocabulary(client, io)).toEqual({
      profileId: "deye.sun-12k",
      metricKeys: [
        { key: "total.energy", isCounter: true },
        { key: "pv.power", isCounter: false },
        { key: "grid.export_limit", isCounter: false },
      ],
      // Configuration keys are the profile's own answer too — never a
      // `settings.%` prefix match, which is one vendor's naming.
      configKeys: ["grid.export_limit"],
    });
  });

  test("a 1.x DOUBLE-ENCODED profile column is unwrapped, not read as a missing profile", async () => {
    // 1.x stores this column as a jsonb STRING holding the profile. A direct read
    // finds no `metrics`, and the legacy export then refuses for a reason that
    // looks like a missing profile.
    const client = await clientOf({
      profiles: [
        {
          id: "row-id",
          data: JSON.stringify({ id: "deye.sun-12k", metrics: [{ key: "pv.power" }] }),
        },
      ],
    });
    const vocabulary = await profileVocabulary(client, io);
    expect(vocabulary.profileId).toBe("deye.sun-12k");
    expect(vocabulary.metricKeys).toEqual([{ key: "pv.power", isCounter: false }]);
  });

  test("a profile document with no id falls back to the ROW's id", async () => {
    const client = await clientOf({ profiles: [{ id: "row-id", data: { metrics: [] } }] });
    expect(await profileVocabulary(client, io)).toEqual({
      profileId: "row-id",
      metricKeys: [],
      configKeys: [],
    });
  });

  test("no installed profile at all is empty, not an error", async () => {
    // A NATIVE export reads `metric_keys` from the database anyway; only a legacy
    // export truly needs this, and it refuses on its own terms.
    expect(await profileVocabulary(await clientOf({}), io)).toEqual({
      profileId: null,
      metricKeys: [],
      configKeys: [],
    });
  });

  test("no installed_profiles TABLE is empty too — a database that predates it", async () => {
    const client = await clientOf({ absent: /installed_profiles/ });
    expect(await profileVocabulary(client, io)).toEqual({
      profileId: null,
      metricKeys: [],
      configKeys: [],
    });
  });
});

describe("runExport", () => {
  test("DETECTS the legacy schema and passes the profile's vocabulary through", async () => {
    const state = seam({
      profiles: [
        {
          id: "p",
          data: {
            id: "deye.sun-12k",
            metrics: [
              { key: "total.energy", kind: "cumulative" },
              { key: "grid.export_limit", storage: "config" },
            ],
          },
        },
      ],
    });
    expect(await runExport([], "postgres://u/db", state.io)).toBe(0);
    expect(state.exports[0]).toMatchObject({
      source: "legacy",
      profileId: "deye.sun-12k",
      configKeys: ["grid.export_limit"],
      includeSecrets: false,
    });
    expect(state.out[0]).toContain("Exporting the pre-2.0.0 schema");
  });

  test("a 2.0.0 database is exported natively, with NO vocabulary forced on it", async () => {
    const state = seam({ hasDevices: true });
    await runExport([], "postgres://u/db", state.io);
    expect(state.exports[0]).toMatchObject({ source: "native" });
    // Undefined, not an empty list: the exporter then reads `metric_keys` itself.
    expect(state.exports[0]?.metricKeys).toBeUndefined();
  });

  test("--legacy and --native OVERRIDE the detection", async () => {
    const withSpine = seam({ hasDevices: true });
    await runExport(["--legacy"], "postgres://u/db", withSpine.io);
    expect(withSpine.exports[0]).toMatchObject({ source: "legacy" });
    const without = seam({});
    await runExport(["--native"], "postgres://u/db", without.io);
    expect(without.exports[0]).toMatchObject({ source: "native" });
  });

  test("the default path is DATED and lands in the working directory", async () => {
    // A second export must not silently overwrite the first, and the file lands in
    // /share on the add-on, read over Samba — so no colon.
    const state = seam({});
    await runExport([], "postgres://u/db", state.io);
    expect(state.exports[0]?.out).toBe("/data/sunreye-export-2026-08-27T10-11-12Z.tar.gz");
  });

  test("--out wins over the dated default", async () => {
    const state = seam({});
    await runExport(["--out", "/share/mine.tar.gz"], "postgres://u/db", state.io);
    expect(state.exports[0]?.out).toBe("/share/mine.tar.gz");
  });

  test("the report gives the ratio, the rows and the wall clock", async () => {
    const state = seam({});
    await runExport([], "postgres://u/db", state.io);
    expect(state.out.at(-1)).toBe(
      "Wrote /data/sunreye-export-2026-08-27T10-11-12Z.tar.gz: 10 readings, 2.0 MB (10.0x compression), 1.2s",
    );
  });

  test("a GAP and a BARREN chunk are WARNED about, never left silent", async () => {
    const state = seam({
      exported: exportResult({
        plan: {
          chunks: [],
          gaps: [
            { start: new Date("2026-08-22T00:00:00Z"), end: new Date("2026-08-23T00:00:00Z") },
          ],
        },
        barren: [
          {
            tier: "minute",
            start: new Date("2026-08-24T00:00:00Z"),
            end: new Date("2026-08-25T00:00:00Z"),
            reason: "that tier's values are all NULL for it",
          },
        ],
      }),
    });
    await runExport([], "postgres://u/db", state.io);
    expect(state.warnings[0]).toContain("no source covered 2026-08-22");
    expect(state.warnings[1]).toBe("  2026-08-24: that tier's values are all NULL for it");
  });

  test("progress is reported per window as the export runs", async () => {
    const state = seam({});
    const io: ArchiveCliIo = {
      ...state.io,
      async archiveModules() {
        return {
          async exportArchive(_client, request) {
            request.onProgress?.({
              tier: "raw",
              window: {
                start: new Date("2026-08-20T00:00:00Z"),
                end: new Date("2026-08-21T00:00:00Z"),
              },
              rows: 5,
              total: 1_234,
            });
            return exportResult();
          },
          importArchive: async () => importResult(),
          defaultWorkDir: (file) => `${file}.work`,
        };
      },
    };
    await runExport([], "postgres://u/db", io);
    expect(state.out).toContain("  raw 2026-08-20: 1,234 readings so far");
  });

  test("--help prints the help and opens NO connection", async () => {
    const state = seam({});
    expect(await runExport(["--help"], "postgres://u/db", state.io)).toBe(0);
    expect(state.out).toEqual([EXPORT_HELP]);
    expect(state.connected).toEqual([]);
  });

  test("the connection is closed and the scratch removed even when the export FAILS", async () => {
    const state = seam({ fail: "a legacy export needs the metric vocabulary" });
    await expect(runExport([], "postgres://u/db", state.io)).rejects.toThrow(/metric vocabulary/);
    expect(state.ended).toHaveLength(1);
    expect(state.removed).toEqual(["/tmp/work-dir"]);
  });
});

describe("runImport", () => {
  test("the flags reach the importer, and the scratch sits BESIDE the archive", async () => {
    // Beside the archive rather than in /tmp: the decompressed tar is the size of
    // the history, and /tmp is a tmpfs on a Home Assistant box.
    const state = seam({});
    expect(
      await runImport(
        ["/share/a.tar.gz", "--force", "--no-refresh", "--no-config", "--device-map", "old=new"],
        "postgres://u/db",
        state.io,
      ),
    ).toBe(0);
    expect(state.imports[0]).toMatchObject({
      file: "/share/a.tar.gz",
      workDir: "/share/a.tar.gz.work",
      force: true,
      refresh: false,
      applyConfig: false,
      deviceMap: { old: "new" },
    });
  });

  test("the defaults REFRESH and APPLY CONFIG, because the alternative is empty charts", async () => {
    const state = seam({});
    await runImport(["/share/a.tar.gz"], "postgres://u/db", state.io);
    expect(state.imports[0]).toMatchObject({ refresh: true, applyConfig: true, force: false });
  });

  test("an archive already imported reports NOTHING TO DO and exits 0", async () => {
    // A retried import must not look broken.
    const state = seam({ imported: importResult({ skipped: "already imported in full" }) });
    expect(await runImport(["/share/a.tar.gz"], "postgres://u/db", state.io)).toBe(0);
    expect(state.out.at(-1)).toBe("Nothing to do: already imported in full");
  });

  test("the summary counts readings and config changes separately", async () => {
    const state = seam({});
    await runImport(["/share/a.tar.gz"], "postgres://u/db", state.io);
    expect(state.out.at(-1)).toBe(
      "Imported 10 readings and 2 config changes from /share/a.tar.gz in 0.9s",
    );
  });

  test("problems are printed AFTER the success line and never swallowed", async () => {
    // The retention warning is the one consequence nothing else in the system
    // would ever surface: the rows are imported, then deleted by the next job.
    const state = seam({
      imported: importResult({ problems: ["the archive's oldest reading is past retention"] }),
    });
    await runImport(["/share/a.tar.gz"], "postgres://u/db", state.io);
    expect(state.warnings).toEqual(["  ! the archive's oldest reading is past retention"]);
  });

  test("progress is reported by stage, with rows only when there are rows", async () => {
    const state = seam({});
    const io: ArchiveCliIo = {
      ...state.io,
      async archiveModules() {
        return {
          exportArchive: async () => exportResult(),
          async importArchive(_client, request) {
            request.onProgress?.({ stage: "readings", rows: 8_160_000 });
            request.onProgress?.({ stage: "refresh", rows: 0 });
            return importResult();
          },
          defaultWorkDir: (file) => `${file}.work`,
        };
      },
    };
    await runImport(["/share/a.tar.gz"], "postgres://u/db", io);
    expect(state.out).toContain("  readings: 8,160,000 rows");
    expect(state.out).toContain("  refresh");
  });

  test("--help prints the help and opens NO connection", async () => {
    const state = seam({});
    expect(await runImport(["--help"], "postgres://u/db", state.io)).toBe(0);
    expect(state.out).toEqual([IMPORT_HELP]);
    expect(state.connected).toEqual([]);
  });

  test("the connection is closed and the scratch removed even when the import FAILS", async () => {
    const state = seam({ fail: "the target already holds 500 row(s)" });
    await expect(runImport(["/share/a.tar.gz"], "postgres://u/db", state.io)).rejects.toThrow();
    expect(state.ended).toHaveLength(1);
    expect(state.removed).toEqual(["/share/a.tar.gz.work"]);
  });
});

describe("runArchiveCommand", () => {
  test("routes export and import", async () => {
    const exporting = seam({});
    expect(await runArchiveCommand("export", [], "postgres://u/db", exporting.io)).toBe(0);
    expect(exporting.exports).toHaveLength(1);
    const importing = seam({});
    expect(
      await runArchiveCommand("import", ["/share/a.tar.gz"], "postgres://u/db", importing.io),
    ).toBe(0);
    expect(importing.imports).toHaveLength(1);
  });

  test("a REFUSAL becomes exit 1 and the SENTENCE, not a stack trace", async () => {
    // Every refusal these paths make is written for an operator, and a stack trace
    // buries the sentence that would have told them what to do.
    const state = seam({ fail: "refusing to import — 1 identity does not exist in the target" });
    expect(
      await runArchiveCommand("import", ["/share/a.tar.gz"], "postgres://u/db", state.io),
    ).toBe(1);
    expect(state.errors).toEqual(["refusing to import — 1 identity does not exist in the target"]);
  });

  test("a bad flag is refused by name rather than falling back to a default", async () => {
    // A typo'd narrowing flag would otherwise export everything, silently.
    const state = seam({});
    expect(await runArchiveCommand("export", ["--tires", "raw"], "postgres://u/db", state.io)).toBe(
      1,
    );
    expect(state.errors[0]).toContain("unknown option --tires");
    expect(state.connected).toEqual([]);
  });

  test("a thrown non-Error still becomes a readable line", async () => {
    const state = seam({});
    const io: ArchiveCliIo = {
      ...state.io,
      archiveModules: () => Promise.reject("the module is gone"),
    };
    expect(await runArchiveCommand("export", [], "postgres://u/db", io)).toBe(1);
    expect(state.errors).toEqual(["the module is gone"]);
  });
});

// ---------------------------------------------------------------------------
// The production wiring. `connect` is deliberately NOT exercised: it opens a real
// connection, and there is no URL it could be pointed at here that is not either
// a real database or a hang. That is exactly why it holds nothing but the factory
// call.
// ---------------------------------------------------------------------------
describe("productionIo", () => {
  test("archiveModules loads the exporter, the importer and its work-dir rule", async () => {
    const modules = await productionIo.archiveModules();
    expect(typeof modules.exportArchive).toBe("function");
    expect(typeof modules.importArchive).toBe("function");
    // Beside the archive, never in the system temp dir.
    expect(modules.defaultWorkDir("/share/a.tar.gz")).toBe("/share/a.tar.gz.work");
  });

  test("profileHelpers are the PROFILE's own answers, from inverter-core", async () => {
    const helpers = await productionIo.profileHelpers();
    expect(helpers.statedKind({ key: "total.energy", kind: "cumulative" })).toBe("cumulative");
    expect(typeof helpers.resolveStorage({ key: "pv.power" })).toBe("string");
    // The 1.x double-encoded shape.
    expect(helpers.unwrapSetting('"dark"')).toBe("dark");
  });

  test("makeWorkDir creates a real scratch directory and remove takes it away", async () => {
    const dir = await productionIo.makeWorkDir();
    writeFileSync(join(dir, "spool"), "x");
    expect(readFileSync(join(dir, "spool"), "utf8")).toBe("x");
    await productionIo.remove(dir);
    expect(await Bun.file(join(dir, "spool")).exists()).toBe(false);
    // Removing what is already gone is not an error: the command may have failed
    // before the directory existed.
    await expect(productionIo.remove(dir)).resolves.toBeUndefined();
  });

  test("now and cwd are read from the process, not frozen at import", async () => {
    expect(productionIo.now().getTime()).toBeGreaterThan(0);
    expect(productionIo.cwd()).toBe(process.cwd());
  });

  test("log and warn go to stdout and stderr the way a CLI's do", () => {
    const out: string[] = [];
    const err: string[] = [];
    const realLog = console.log;
    const realWarn = console.warn;
    const realError = console.error;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.warn = (...a: unknown[]) => void err.push(`warn:${a.join(" ")}`);
    console.error = (...a: unknown[]) => void err.push(`error:${a.join(" ")}`);
    try {
      productionIo.log("Wrote /share/a.tar.gz");
      productionIo.warn("  ! past retention");
      productionIo.error("refusing to import");
    } finally {
      console.log = realLog;
      console.warn = realWarn;
      console.error = realError;
    }
    expect(out).toEqual(["Wrote /share/a.tar.gz"]);
    expect(err).toEqual(["warn:  ! past retention", "error:refusing to import"]);
  });
});
