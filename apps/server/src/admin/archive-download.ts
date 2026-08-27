/**
 * The portable archive as an HTTP DOWNLOAD — streamed, never buffered.
 *
 * `downloadText` in `apps/web/src/lib/utils.ts` is fine for a settings blob: it
 * builds the whole payload as a string in the browser. A full history export is
 * ~9 M readings, and the file measured on the real 1.2.0 fixture is 53 MB, so
 * that route is not available here in either direction — the server cannot hold
 * it and the browser should not have to.
 *
 * So the response is a `Bun.file`, which the runtime streams from disk with a
 * real `Content-Length` and a `Content-Disposition`. Memory stays flat and the
 * browser writes straight to the user's downloads folder, resumably.
 *
 * ## Why it spools to a file at all
 *
 * A tar header must declare its member's SIZE before the body, and
 * `manifest.json` carries the per-stream counts an importer verifies against — a
 * number only known once every row has been read. Both facts make a
 * single-pass-to-socket container impossible; see
 * `packages/db/src/archive-file.ts`. The spool is the price, and it buys a
 * `Content-Length` that a chunked stream could not offer anyway.
 *
 * ## The IO seam
 *
 * The filesystem, the connection, the exporter and the log all go through
 * {@link DownloadIo}, defaulted to {@link productionIo} as a parameter so the
 * route does not change — the same seam `apps/server/src/archive-cli.ts` and
 * `scripts/archive-round-trip.ts` use. What it buys is that the SPOOL LOCATION,
 * the sweep's refusals, and the cleanup on failure are provable without writing
 * 53 MB anywhere.
 *
 * ## Why NOT `/tmp`
 *
 * On a Home Assistant box `/tmp` is a TMPFS. Spooling 53 MB there does not use
 * disk, it uses RAM — on a 2 GB machine, which is the exact failure the
 * streaming design exists to avoid. `/data` (the addon's persistent datadir, the
 * one included in HA backups) and `/share` are tried first, and
 * `os.tmpdir()` is only the last resort. {@link pickSpoolRoot} is the decision
 * and it is unit-tested.
 */

import { existsSync, type Stats } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExportRequest, ExportResult } from "@SunReye/db/archive-export";

import { log } from "../shared/logging";

const downloadLog = log();

/** A single connection the exporter can drive. Never the shared pool. */
export interface DownloadClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

/** Everything this module touches that is not a decision. */
export interface DownloadIo {
  exists(path: string): boolean;
  readdir(path: string): Promise<string[]>;
  statOf(path: string): Promise<Pick<Stats, "mtimeMs">>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** A fresh spool directory under `root`, named so a sweep can find it. */
  makeSpool(root: string): Promise<string>;
  /** Last resort when no candidate root exists. A TMPFS on a HA box. */
  tmpRoot(): string;
  now(): Date;
  /**
   * ITS OWN CONNECTION, not the shared pool, and for two independent reasons.
   *
   * `ReplayClient` speaks positional `$n` parameters — it is `pg.Client`'s own
   * shape — so a drizzle client would have to have its statements rewritten to
   * reach it, which means interpolating values into SQL text. There is no version
   * of that worth writing on a path this size.
   *
   * And a full export is tens of seconds of queries. Holding a pooled connection
   * for that long would starve the poll loop, which is writing to the same
   * database at 1 Hz.
   */
  connect(): Promise<DownloadClient>;
  exportArchive(client: DownloadClient, request: ExportRequest): Promise<ExportResult>;
  /**
   * The configuration keys, from the installed profile.
   *
   * A NATIVE export reads `metric_keys` out of the database, so this is belt: it
   * only matters when the two disagree, and then the profile is the authority on
   * which metrics are configuration (`resolveStorage`) — never a `settings.%`
   * prefix match, which is one vendor's naming and stops applying on the next.
   */
  configKeys(): Promise<string[]>;
  appVersion(): string | undefined;
  info(message: string, fields: Record<string, unknown>): void;
}

/**
 * The real wiring. The dynamic imports stay dynamic: this module is reached from
 * an admin route, and a static import of the exporter and `pg` would load both
 * into every server boot.
 */
export const productionIo: DownloadIo = {
  exists: existsSync,
  readdir: (path) => readdir(path),
  statOf: (path) => stat(path),
  remove: async (path) => {
    await rm(path, { recursive: true, force: true });
  },
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  makeSpool: (root) => mkdtemp(join(root, "export-")),
  tmpRoot: () => tmpdir(),
  now: () => new Date(),
  connect: async () => {
    const { productionRuntime } = await import("@SunReye/db/migrate");
    const { env } = await import("@SunReye/env/server");
    const client = productionRuntime.createClient(env.DATABASE_URL);
    await client.connect();
    return client as unknown as DownloadClient;
  },
  exportArchive: async (client, request) => {
    const { exportArchive } = await import("@SunReye/db/archive-export");
    return exportArchive(client, request);
  },
  configKeys: async () => {
    try {
      const { resolveStorage } = await import("@SunReye/inverter-core");
      const { db } = await import("@SunReye/db");
      const { sql } = await import("drizzle-orm");
      const rows = await db.execute(
        sql`select data from installed_profiles order by installed_at desc limit 1`,
      );
      const data = (rows.rows[0] as { data?: { metrics?: unknown[] } } | undefined)?.data;
      const metrics = (data?.metrics ?? []) as never[];
      return metrics
        .filter((metric) => resolveStorage(metric) === "config")
        .map((metric) => (metric as { key: string }).key);
    } catch {
      // No profile installed. A native export still carries every metric key.
      return [];
    }
  },
  appVersion: () => process.env.SUNREYE_VERSION,
  info: (message, fields) => downloadLog.info(message, fields),
};

/**
 * Spool roots in priority order: real disk before the tmpfs, PRIVATE before
 * shared.
 *
 * `/data` first, and that ordering is a security decision rather than a
 * preference. `/data` is the add-on's own persistent directory; `/share` is served
 * to the whole LAN by the Samba add-on. This spool is transient — it exists only
 * while the browser streams the response — so it has no business being visible,
 * even briefly. `/share` is where an operator DELIBERATELY writes an export with
 * `sunreye export --out`, which is their choice to make; it is only the fallback
 * here for a deployment that has no `/data`.
 */
export const SPOOL_CANDIDATES = ["/data", "/share"] as const;

/** Sub-directory the spools live in, so a sweep never touches anything else. */
export const SPOOL_DIR = "sunreye-exports";

/** The first candidate that exists, or null to fall back to `os.tmpdir()`. */
export function pickSpoolRoot(
  candidates: readonly string[],
  exists: (path: string) => boolean,
): string | null {
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * The download's filename.
 *
 * No colon, no space, no slash: the file is offered into `/share`, which is read
 * over Samba, and a colon is not a legal filename character on a Windows client
 * — the file would arrive and be unopenable.
 */
export function exportFilename(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  return `sunreye-export-${stamp}Z.tar.gz`;
}

/** How long a spool is left alone before a later export may sweep it. */
const SPOOL_TTL_MS = 3_600_000;

/**
 * Whether a spool directory is old enough to delete.
 *
 * An hour, and the generosity is deliberate: a spool is deleted only by a LATER
 * export, and deleting one a browser is still streaming from would truncate the
 * operator's download with no error anywhere. A future mtime (a clock jump, an
 * NTP correction) is never stale, for the same reason.
 */
export function isStaleSpool(entry: Pick<Stats, "mtimeMs">, now: number): boolean {
  const age = now - entry.mtimeMs;
  return age > SPOOL_TTL_MS;
}

/** Remove spools a previous download finished with. Best effort, never fatal. */
export async function sweep(root: string, io: DownloadIo = productionIo): Promise<void> {
  try {
    const now = io.now().getTime();
    for (const name of await io.readdir(root)) {
      const path = join(root, name);
      try {
        if (isStaleSpool(await io.statOf(path), now)) await io.remove(path);
      } catch {
        // A spool another process is mid-way through removing. Not ours to fix.
      }
    }
  } catch {
    // The root does not exist yet — the first export creates it.
  }
}

export interface ArchiveDownload {
  /** The finished file, streamed by the runtime rather than read into memory. */
  path: string;
  filename: string;
  bytes: number;
  rows: number;
}

/**
 * Build the archive and return where it is, for the route to stream.
 *
 * NOT `resetTimeseries`'s neighbour by accident: this is the counterpart the
 * Danger Zone was missing. "Delete all data" without "take a copy first" is a
 * button nobody should be asked to press.
 */
export async function buildExportArchive(io: DownloadIo = productionIo): Promise<ArchiveDownload> {
  const base = pickSpoolRoot(SPOOL_CANDIDATES, io.exists);
  const root = base === null ? join(io.tmpRoot(), SPOOL_DIR) : join(base, SPOOL_DIR);
  await sweep(root, io);
  await io.mkdir(root);
  const workDir = await io.makeSpool(root);

  const filename = exportFilename(io.now());
  const out = join(workDir, filename);
  const configKeys = await io.configKeys();

  /**
   * ITS OWN CONNECTION, not the shared pool, and for two independent reasons.
   *
   * `ReplayClient` speaks positional `$n` parameters — it is `pg.Client`'s own
   * shape — so a drizzle client would have to have its statements rewritten to
   * reach it, which means interpolating values into SQL text. There is no version
   * of that worth writing on a path this size.
   *
   * And a full export is tens of seconds of queries. Holding a pooled connection
   * for that long would starve the poll loop, which is writing to the same
   * database at 1 Hz.
   */
  const client = await io.connect();
  try {
    const result = await io.exportArchive(client, {
      source: "native",
      out,
      workDir,
      configKeys,
      appVersion: io.appVersion(),
    });
    io.info("archive export built: {rows} readings, {bytes} bytes, {ms} ms", {
      rows: result.manifest.rows,
      bytes: result.bytes,
      ms: result.elapsedMs,
    });
    return { path: out, filename, bytes: result.bytes, rows: result.manifest.rows };
  } catch (error) {
    // The spool is useless without a finished archive, and leaving it would make
    // the next sweep the only thing that ever removed it.
    await io.remove(workDir);
    throw error;
  } finally {
    // Always: a leaked connection here is one fewer backend for the poll loop,
    // and it would leak once per export rather than once ever.
    await client.end();
  }
}
