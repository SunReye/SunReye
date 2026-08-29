/**
 * `sunreye export` and `sunreye import` — the CLI half of the portable archive.
 *
 * Reached from `./main.ts` through a DYNAMIC import, following the `migrate`
 * branch exactly: neither subcommand may boot the server, because a box being
 * exported is often a box that cannot start. So nothing here imports the runtime,
 * the routes, or MQTT — only `@SunReye/db` and the profile reader.
 *
 * ## Why the source is DETECTED rather than assumed
 *
 * The export reads either schema (see `@SunReye/db/archive-export`), and getting
 * it wrong fails SILENTLY in the worst direction: a native read of a 1.2.0
 * database joins `devices`, finds no such table, and produces a perfectly valid
 * archive containing no history at all. So {@link sourceForShape} asks the
 * database which shape it is, and `--legacy` / `--native` only override.
 *
 * ## Why the metric vocabulary comes from the PROFILE
 *
 * A 1.x database has no `metric_keys` table, so nothing in it records which
 * metrics are counters — and `is_counter` is what puts `counter_agg` on the right
 * series in 2.0.0. Defaulting it to false makes every energy total on the other
 * side a naive max-minus-min: measured on the real fixture, 64280.971 kWh against
 * a truth of 41.971. The profile is the only place that knows, so the profile is
 * read here (`statedKind`, `resolveStorage` — never a `settings.%` prefix match,
 * which is one vendor's naming and stops applying on the next).
 */

import type { SourceTier } from "@SunReye/db/archive";

/** The subcommand words `main.ts` routes on. Must never look like a flag. */
export const ARCHIVE_SUBCOMMANDS = ["export", "import"] as const;

/**
 * Every flag any branch of the binary understands.
 *
 * Listed so `./archive-cli.test.ts` can prove no subcommand collides with one:
 * `main.ts` routes on a bare `process.argv.includes("export")` over the WHOLE
 * argv, so a flag spelled the same as a subcommand would turn a server boot into
 * a data export.
 */
export const KNOWN_FLAGS = [
  "--healthcheck",
  "--out",
  "--file",
  "--tiers",
  "--legacy",
  "--native",
  "--force",
  "--no-refresh",
  "--no-config",
  "--device-map",
  "--include-secrets",
  "--help",
] as const;

const TIERS: readonly string[] = ["raw", "minute", "hourly", "daily"];

export interface ExportOptions {
  out: string | null;
  tiers?: SourceTier[];
  source?: "native" | "legacy";
  /** Carry the MQTT password and provider tokens. Off by default — see the flag. */
  includeSecrets: boolean;
  help: boolean;
}

export interface ImportOptions {
  file: string;
  force: boolean;
  refresh: boolean;
  applyConfig: boolean;
  deviceMap: Record<string, string>;
  help: boolean;
}

/** `old=new,a=b` to a rename table, refusing anything it cannot read. */
export function parseDeviceMap(spec: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of spec.split(",")) {
    const trimmed = pair.trim();
    if (trimmed.length === 0) continue;
    const [from, to] = trimmed.split("=").map((part) => part.trim());
    if (!from || !to) {
      // Refused, not skipped: a dropped mapping means the history lands under the
      // ORIGINAL slug, which is exactly what the operator was avoiding.
      throw new Error(
        `--device-map: ${JSON.stringify(trimmed)} is not an <archive-slug>=<target-slug> pair`,
      );
    }
    map[from] = to;
  }
  return map;
}

/** The default file name. Dated, so a second export cannot silently overwrite. */
export function defaultArchiveName(now: Date): string {
  // No colon and no space: the file lands in the addon's `/share`, which is read
  // over Samba, and a colon is not a legal filename on a Windows client.
  const stamp = now.toISOString().replace(/:/g, "-").replace(/\..*$/, "");
  return `sunreye-export-${stamp}Z.tar.gz`;
}

const requireValue = (argv: readonly string[], index: number, flag: string): string => {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
};

/**
 * One flag, as a table entry.
 *
 * Table-driven rather than an if/else chain, and not for elegance: the chain was
 * one function carrying every flag's arity AND its effect AND the refusal, which
 * is three concerns and a cognitive score to match. Here the arity is `takesValue`
 * and the effect is `apply`, so adding a flag cannot change how any other one is
 * read.
 */
interface FlagSpec<T> {
  takesValue: boolean;
  apply(options: T, value: string): void;
}

/**
 * Fold `argv` over a flag table.
 *
 * An unrecognised flag is REFUSED rather than ignored: a typo'd narrowing flag
 * would otherwise fall back silently to exporting everything, or to the wrong
 * source. A bare word is handed to `positional`, or refused when there is none.
 */
function parseFlags<T>(
  argv: readonly string[],
  command: string,
  flags: Record<string, FlagSpec<T>>,
  options: T,
  positional?: (options: T, value: string) => void,
): T {
  for (let i = 0; i < argv.length; i++) {
    i = consumeArg({ argv, i, command, flags, options, positional });
  }
  return options;
}

/** Everything one argument's handling needs, so the signature stays legible. */
interface ConsumeInput<T> {
  argv: readonly string[];
  i: number;
  command: string;
  flags: Record<string, FlagSpec<T>>;
  options: T;
  positional?: (options: T, value: string) => void;
}

/**
 * Handle the argument at `i`, returning the index of the last one it consumed.
 *
 * Returning the index rather than mutating a loop variable is what lets a
 * value-taking flag swallow its value without the loop knowing which flags do.
 */
function consumeArg<T>(input: ConsumeInput<T>): number {
  const { argv, i, command, flags, options, positional } = input;
  const arg = argv[i] as string;
  if (arg === command) return i;
  if (!arg.startsWith("-")) {
    takePositional(command, options, arg, positional);
    return i;
  }
  const spec = flags[arg];
  // Refused, never ignored: a typo'd narrowing flag would otherwise fall back
  // silently to exporting everything, or to the wrong source.
  if (spec === undefined) throw new Error(`sunreye ${command}: unknown option ${arg}`);
  if (!spec.takesValue) {
    spec.apply(options, "");
    return i;
  }
  spec.apply(options, requireValue(argv, i + 1, arg));
  return i + 1;
}

/** A bare word, or a refusal when the command takes none. */
function takePositional<T>(
  command: string,
  options: T,
  value: string,
  positional?: (options: T, value: string) => void,
): void {
  if (positional === undefined) {
    throw new Error(`sunreye ${command}: unexpected argument ${value}`);
  }
  positional(options, value);
}

const flag = <T>(apply: (options: T) => void): FlagSpec<T> => ({
  takesValue: false,
  apply: (options) => apply(options),
});

const valued = <T>(apply: (options: T, value: string) => void): FlagSpec<T> => ({
  takesValue: true,
  apply,
});

/** The tiers `--tiers` accepts, refusing anything else by name. */
function parseTiers(value: string): SourceTier[] {
  const tiers = value.split(",").map((tier) => tier.trim());
  for (const tier of tiers) {
    if (!TIERS.includes(tier)) {
      throw new Error(`--tiers: ${JSON.stringify(tier)} is not one of ${TIERS.join(", ")}`);
    }
  }
  return tiers as SourceTier[];
}

export function parseExportArgs(argv: readonly string[]): ExportOptions {
  return parseFlags<ExportOptions>(
    argv,
    "export",
    {
      "--out": valued((options, value) => {
        options.out = value;
      }),
      "--tiers": valued((options, value) => {
        options.tiers = parseTiers(value);
      }),
      "--legacy": flag((options) => {
        options.source = "legacy";
      }),
      "--native": flag((options) => {
        options.source = "native";
      }),
      "--include-secrets": flag((options) => {
        options.includeSecrets = true;
      }),
      "--help": flag((options) => {
        options.help = true;
      }),
    },
    { out: null, includeSecrets: false, help: false },
  );
}

export function parseImportArgs(argv: readonly string[]): ImportOptions {
  const options = parseFlags<ImportOptions>(
    argv,
    "import",
    {
      "--file": valued((o, value) => {
        o.file = value;
      }),
      "--device-map": valued((o, value) => {
        o.deviceMap = parseDeviceMap(value);
      }),
      "--force": flag((o) => {
        o.force = true;
      }),
      "--no-refresh": flag((o) => {
        o.refresh = false;
      }),
      "--no-config": flag((o) => {
        o.applyConfig = false;
      }),
      "--help": flag((o) => {
        o.help = true;
      }),
    },
    {
      file: "",
      force: false,
      // ON by default. The refresh POLICIES only cover their recent start_offset
      // (3 hours) and will NEVER reach imported history, so without this the
      // hypertable is full and every chart is empty.
      refresh: true,
      applyConfig: true,
      deviceMap: {},
      help: false,
    },
    (o, value) => {
      o.file = value;
    },
  );
  if (options.file.length === 0 && !options.help) {
    throw new Error("sunreye import: no archive given (pass a path, or --file <path>)");
  }
  return options;
}

/**
 * Route one argv to a subcommand, or `null` for "boot the server".
 *
 * Lives here rather than in `./main.ts` so it is testable: `main.ts` is the one
 * file nothing imports, and a routing decision that only exists inside an
 * entrypoint is a routing decision nothing can prove.
 *
 * Whole-element matching, which is what makes it safe: a PATH containing the word
 * (a worktree called `w-export`) cannot trigger it. A FLAG spelled the same as a
 * subcommand would, which is why {@link KNOWN_FLAGS} exists and its suite proves
 * none of them collides.
 */
export function routeSubcommand(argv: readonly string[]): "export" | "import" | null {
  for (const name of ARCHIVE_SUBCOMMANDS) {
    if (argv.includes(name)) return name;
  }
  return null;
}

/** Which schema to read. See the module header for why detection, not assumption. */
export function sourceForShape(
  shape: { hasDevices: boolean },
  explicit: "native" | "legacy" | undefined,
): "native" | "legacy" {
  if (explicit !== undefined) return explicit;
  return shape.hasDevices ? "native" : "legacy";
}

export const EXPORT_HELP = `sunreye export — write this instance's history to a portable archive

  sunreye export [--out <path>] [--tiers raw,minute,hourly,daily] [--legacy|--native]

A gzipped tar holding manifest.json, config.json, config-log.ndjson.gz and
readings.ndjson.gz. Everything in it is named by device SLUG and metric KEY, so a
future SunReye can read it whatever its internal encoding. It carries NO auth
tables: password hashes and sessions are a liability in a portable file, and
recreating the admin account is an onboarding step.

  --out <path>     where to write (default: ./sunreye-export-<date>.tar.gz)
  --tiers <list>   which sources to consider, finest first (default: all)
  --legacy         read the pre-2.0.0 schema (detected by default)
  --native         read the 2.0.0 schema (detected by default)
  --include-secrets
                   carry the MQTT password and any provider token. OFF by
                   default: those are stored in plaintext, the REST API refuses
                   to return them, and on the Home Assistant add-on the export
                   lands in /share, which Samba serves to the whole LAN. Use it
                   when MOVING MACHINES, and treat the file as a credential.
`;

export const IMPORT_HELP = `sunreye import — read a portable archive into this database

  sunreye import <path> [--force] [--no-refresh] [--no-config] [--device-map a=b]

Applies config.json (plant graph, settings, profiles, charts, metric vocabulary),
inserts the raw readings, replays the bucket tiers through the shared bucket
replay, then refreshes the continuous aggregates over the WHOLE imported span.

Import into an EMPTY database. metrics_raw has no unique key, so importing over
history the target already holds DUPLICATES it rather than replacing it — which
does not error, it just reports a wrong kWh figure later. That case is refused;
re-importing the same archive is a no-op.

  --force        accept duplicate rows over an existing span
  --no-refresh   skip the aggregate refresh (charts will be EMPTY until you run
                 one by hand — the refresh policies never reach imported history)
  --no-config    do not touch settings/profiles/charts or the plant graph
  --device-map   rename devices on the way in: <archive-slug>=<target-slug>
`;

// ---------------------------------------------------------------------------
// The IO half.
//
// Every connection, every module load, every scratch directory and every line of
// output goes through {@link ArchiveCliIo}, defaulted to {@link productionIo} as
// a parameter so no call site changes — the same seam
// `scripts/archive-round-trip.ts` (`RoundTripIo`) and `scripts/fixture-1-2-0.ts`
// (`FixtureIo`) use. What that buys is that the ORDER of the steps, the flag
// handling, the detection, the vocabulary and the exit codes are provable here,
// while what a real statement does stays proved by running it
// (`apps/server/db-tests/archive.test.ts` for the statements,
// `scripts/archive-round-trip.ts` for the whole loop).
//
// The module loads stay DYNAMIC and stay inside `productionIo`: `./main.ts`
// imports this file on every boot to reach `routeSubcommand`, so a static import
// of the exporter, the importer or `pg` would load all three into a plain server
// start.
// ---------------------------------------------------------------------------

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExportRequest, ExportResult } from "@SunReye/db/archive-export";
import type { ImportRequest, ImportResult } from "@SunReye/db/archive-import";

/**
 * A SINGLE connection — never a pool.
 *
 * The bucket replay expresses its per-chunk transaction as `begin`/`commit`
 * statements, and on a pool those could land on different backends, which would
 * silently drop the one property resumability rests on
 * (`packages/db/src/replay-run.ts`).
 */
export interface CliClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

/** The archive modules, loaded only when a subcommand actually runs. */
export interface ArchiveModules {
  exportArchive(client: CliClient, request: ExportRequest): Promise<ExportResult>;
  importArchive(client: CliClient, request: ImportRequest): Promise<ImportResult>;
  defaultWorkDir(file: string): string;
}

/**
 * The profile's own answers about a metric.
 *
 * `statedKind` and `resolveStorage`, never a `settings.%` prefix match — that is
 * one vendor's naming and silently stops applying on the next (issue #150).
 * `unwrapSetting` because a 1.x database stores `installed_profiles.data` as a
 * jsonb STRING holding the profile rather than as the profile.
 */
export interface ProfileHelpers {
  statedKind(metric: unknown): string;
  resolveStorage(metric: unknown): string;
  unwrapSetting(value: unknown): unknown;
}

export interface ArchiveCliIo {
  connect(databaseUrl: string): Promise<CliClient>;
  archiveModules(): Promise<ArchiveModules>;
  profileHelpers(): Promise<ProfileHelpers>;
  /** Scratch directory for the export spools. Removed by the caller. */
  makeWorkDir(): Promise<string>;
  remove(path: string): Promise<void>;
  now(): Date;
  cwd(): string;
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * The real wiring.
 *
 * `connect` goes through `productionRuntime.createClient` rather than
 * `new Client` directly: `pg` is a dependency of `@SunReye/db`, not of
 * `apps/server`, and the factory that already exists there is the one place that
 * knows how this project builds a client.
 */
export const productionIo: ArchiveCliIo = {
  connect: async (databaseUrl) => {
    const { productionRuntime } = await import("@SunReye/db/migrate");
    const client = productionRuntime.createClient(databaseUrl);
    await client.connect();
    return client as unknown as CliClient;
  },
  archiveModules: async () => {
    const exporter = await import("@SunReye/db/archive-export");
    const importer = await import("@SunReye/db/archive-import");
    return {
      exportArchive: exporter.exportArchive as ArchiveModules["exportArchive"],
      importArchive: importer.importArchive as ArchiveModules["importArchive"],
      defaultWorkDir: importer.defaultWorkDir,
    };
  },
  profileHelpers: async () => {
    const { resolveStorage, statedKind } = await import("@SunReye/inverter-core");
    const { unwrapSetting } = await import("@SunReye/db/archive-config");
    return {
      statedKind: statedKind as ProfileHelpers["statedKind"],
      resolveStorage: resolveStorage as ProfileHelpers["resolveStorage"],
      unwrapSetting,
    };
  },
  makeWorkDir: () => mkdtemp(join(tmpdir(), "sunreye-export-")),
  remove: async (path) => {
    await rm(path, { recursive: true, force: true });
  },
  now: () => new Date(),
  cwd: () => process.cwd(),
  log: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

/** The vocabulary and the configuration keys an export needs. */
export interface Vocabulary {
  profileId: string | null;
  metricKeys: { key: string; isCounter: boolean }[];
  configKeys: string[];
}

/**
 * The metric vocabulary and the configuration keys, from the ACTIVE PROFILE.
 *
 * Falls back to whatever `installed_profiles` holds when no profile is active,
 * and to nothing at all when there is none: a NATIVE export reads `metric_keys`
 * from the database anyway, and only a legacy export truly needs this.
 */
export async function profileVocabulary(
  client: CliClient,
  io: ArchiveCliIo = productionIo,
): Promise<Vocabulary> {
  let rows: { id: string; data: unknown }[] = [];
  try {
    rows = (
      await client.query("select id, data from installed_profiles order by installed_at desc")
    ).rows as { id: string; data: unknown }[];
  } catch {
    // No such table: a database that predates it, which a legacy export then
    // refuses for a reason of its own rather than crashing here.
    rows = [];
  }
  const first = rows[0];
  if (!first) return { profileId: null, metricKeys: [], configKeys: [] };
  const { statedKind, resolveStorage, unwrapSetting } = await io.profileHelpers();
  const data = unwrapSetting(first.data) as { id?: string; metrics?: unknown[] } | null;
  const metrics = (data?.metrics ?? []) as unknown[];
  return {
    profileId: data?.id ?? first.id,
    metricKeys: metrics.map((metric) => ({
      key: (metric as { key: string }).key,
      isCounter: statedKind(metric) === "cumulative",
    })),
    configKeys: metrics
      .filter((metric) => resolveStorage(metric) === "config")
      .map((metric) => (metric as { key: string }).key),
  };
}

/** Does this database have the 2.0.0 dimension spine? */
export async function readShape(client: CliClient): Promise<{ hasDevices: boolean }> {
  const result = await client.query(`select to_regclass('public.devices') is not null as present`);
  return { hasDevices: (result.rows[0] as { present: boolean } | undefined)?.present === true };
}

export async function runExport(
  argv: readonly string[],
  databaseUrl: string,
  io: ArchiveCliIo = productionIo,
): Promise<number> {
  const options = parseExportArgs(argv);
  if (options.help) {
    io.log(EXPORT_HELP);
    return 0;
  }
  const { exportArchive } = await io.archiveModules();
  const out = options.out ?? join(io.cwd(), defaultArchiveName(io.now()));
  const workDir = await io.makeWorkDir();
  const client = await io.connect(databaseUrl);
  try {
    const source = sourceForShape(await readShape(client), options.source);
    const vocabulary = await profileVocabulary(client, io);
    io.log(`Exporting the ${source === "legacy" ? "pre-2.0.0" : "2.0.0"} schema to ${out}`);
    const result = await exportArchive(client, {
      source,
      out,
      workDir,
      tiers: options.tiers,
      includeSecrets: options.includeSecrets,
      profileId: vocabulary.profileId,
      metricKeys: vocabulary.metricKeys.length > 0 ? vocabulary.metricKeys : undefined,
      configKeys: vocabulary.configKeys,
      onProgress: ({ tier, window, total }) =>
        io.log(
          `  ${tier} ${window.start.toISOString().slice(0, 10)}: ${total.toLocaleString("en-US")} readings so far`,
        ),
    });
    const ratio = result.uncompressedBytes / Math.max(1, result.bytes);
    io.log(
      `Wrote ${out}: ${result.manifest.rows.toLocaleString("en-US")} readings, ` +
        `${(result.bytes / 1024 / 1024).toFixed(1)} MB (${ratio.toFixed(1)}x compression), ` +
        `${(result.elapsedMs / 1000).toFixed(1)}s`,
    );
    for (const gap of result.plan.gaps) {
      io.warn(
        `  no source covered ${gap.start.toISOString()}..${gap.end.toISOString()} — that day is ` +
          `NOT in the archive`,
      );
    }
    for (const chunk of result.barren) {
      io.warn(`  ${chunk.start.toISOString().slice(0, 10)}: ${chunk.reason}`);
    }
    return 0;
  } finally {
    await client.end();
    await io.remove(workDir);
  }
}

export async function runImport(
  argv: readonly string[],
  databaseUrl: string,
  io: ArchiveCliIo = productionIo,
): Promise<number> {
  const options = parseImportArgs(argv);
  if (options.help) {
    io.log(IMPORT_HELP);
    return 0;
  }
  const { importArchive, defaultWorkDir } = await io.archiveModules();
  const workDir = defaultWorkDir(options.file);
  const client = await io.connect(databaseUrl);
  try {
    const result = await importArchive(client, {
      file: options.file,
      workDir,
      force: options.force,
      refresh: options.refresh,
      applyConfig: options.applyConfig,
      deviceMap: options.deviceMap,
      onProgress: ({ stage, rows }) =>
        io.log(`  ${stage}${rows > 0 ? `: ${rows.toLocaleString("en-US")} rows` : ""}`),
    });
    if (result.skipped !== null) {
      io.log(`Nothing to do: ${result.skipped}`);
      return 0;
    }
    io.log(
      `Imported ${result.manifest.rows.toLocaleString("en-US")} readings and ` +
        `${result.inserted.configLog.toLocaleString("en-US")} config changes from ` +
        `${options.file} in ${(result.elapsedMs / 1000).toFixed(1)}s`,
    );
    // Printed AFTER the success line and never swallowed: the retention warning is
    // the one consequence nothing else in the system would ever surface.
    for (const problem of result.problems) io.warn(`  ! ${problem}`);
    return 0;
  } finally {
    await client.end();
    await io.remove(workDir);
  }
}

/**
 * Run one subcommand and turn any refusal into an exit code.
 *
 * The error handling lives here rather than in `./main.ts` so it is reachable
 * from a test: every refusal these paths make is written FOR AN OPERATOR (an
 * unknown device slug, a newer format version, a span the target already holds
 * rows for), and a stack trace buries the sentence that would have told them what
 * to do.
 */
export async function runArchiveCommand(
  route: "export" | "import",
  argv: readonly string[],
  databaseUrl: string,
  io: ArchiveCliIo = productionIo,
): Promise<number> {
  try {
    return route === "export"
      ? await runExport(argv, databaseUrl, io)
      : await runImport(argv, databaseUrl, io);
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
