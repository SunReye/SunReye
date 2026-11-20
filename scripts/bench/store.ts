// fallow-ignore-file coverage-gaps -- needs the ten-year file and Docker; run by hand with `bun run bench`.
// The benchmark's file and image (ADR 24): the cached ten years, the throwaway copy the core runs
// on, and what that copy holds before the core opens it.

import { Database } from "bun:sqlite";
import { join } from "node:path";

import { run } from "../smoke.ts";
import { HOUR, WEATHER } from "./reads.ts";

export const ROOT = new URL("../..", import.meta.url).pathname;

/** `RETENTION` in `crates/core/src/storage.rs`, until the admin sets it. */
const RETENTION_S = 1827 * 86_400;

/** A progress line, stamped with the seconds since the run began. */
export const log = (line: string): void =>
  void process.stderr.write(`bench +${(performance.now() / 1000).toFixed(0)} s: ${line}\n`);

/** The cached ten-year file, generated when missing (about 1.5 h). */
export async function cachedFile(): Promise<string> {
  const synth = ["cargo", "run", "--release", "-q", "-p", "sunreye-synth", "--"];
  const key = await run([...synth, "--key"], ROOT);
  const dir = join(ROOT, "target", "bench", key);
  const file = join(dir, "core.sqlite");

  if (!(await Bun.file(file).exists())) {
    log(`no ${key} yet: generating ten years`);
    await run([...synth, "--out", dir], ROOT);
  }

  return file;
}

/** Builds the release image of this commit; its tag. */
export interface Image {
  readonly tag: string;
  /** Whether a later run on the same commit may reuse it. */
  readonly reusable: boolean;
}

/** The image of commit `sha`; a tree `git status --porcelain` lists changes in is never reused. */
export function imageTag(sha: string, porcelain: string): Image {
  const reusable = porcelain.trim() === "";

  return { tag: `sunreye-bench:${sha}${reusable ? "" : "-dirty"}`, reusable };
}

/** The release image of this tree, built unless a clean commit's image already exists. */
export async function buildImage(): Promise<Image> {
  const sha = await run(["git", "rev-parse", "HEAD"], ROOT);
  const image = imageTag(sha, await run(["git", "status", "--porcelain"], ROOT));

  const exists = await run(["docker", "image", "inspect", "-f", "{{.Id}}", image.tag]).then(
    () => true,
    () => false,
  );

  if (image.reusable && exists) return image;

  const build = ["docker", "build", "--network", "host", "-q", "-f", "packaging/Dockerfile"];

  // The core embeds the SPA's build (ADR 11).
  await run(["bun", "run", "--cwd", "apps/web", "build"], ROOT);
  await run([...build, "--target", "core", "-t", image.tag, "."], ROOT);

  return image;
}

/** Copies the cached file into `data`, sharing its blocks where the file system can. */
export async function copy(cache: string, data: string): Promise<string> {
  const file = join(data, "core.sqlite");

  await run(["cp", "--reflink=auto", cache, file]);

  return file;
}

/** Writes `file` out and drops it from the page cache, so the core's first reads are cold. */
export async function evict(file: string): Promise<void> {
  const flags = ["oflag=nocache", "conv=notrunc,fdatasync", "count=0", "status=none"];

  await run(["dd", `of=${file}`, ...flags]);
}

/** What the copy holds before the core opens it. */
export interface Store {
  readonly version: number;
  /** The end of the last stored hour, in ms since 1970. */
  readonly end: number;
  /** The first hour, counted from 1970, whose change points retention keeps. */
  readonly horizon: number;
  /** The plant's devices' TCP ports on loopback. */
  readonly ports: readonly number[];
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- bun:sqlite's handle, used in place.
function number(db: Database, sql: string, ...args: readonly number[]): number {
  const row = db.query<{ n: number }, number[]>(sql).get(...args);

  return row?.n ?? Number.NaN;
}

/** Reads the copy; throws when a device connection leaves loopback. */
export function inspect(file: string): Store {
  const db = new Database(file);

  try {
    const kept = number(db, "SELECT value AS n FROM meta WHERE key = 'retention'");
    const horizon = Math.floor((Date.now() / 1000 - (kept || RETENTION_S)) / 3600);

    const connections = db
      .query<{ readonly host: string; readonly port: number }, []>(
        "SELECT host, port FROM connection",
      )
      .all();

    for (const { host, port } of connections)
      if (host !== "127.0.0.1") throw new Error(`a device connection reaches ${host}:${port}`);

    return {
      version: number(db, "SELECT user_version AS n FROM pragma_user_version"),
      end: (number(db, "SELECT max(hour) AS n FROM block") + 1) * HOUR,
      horizon,
      ports: connections.map((c) => c.port),
    };
  } finally {
    db.close();
  }
}

/** Expired blocks deleted per tick: `PRUNE` in `crates/core/src/storage/thread.rs`. */
const PRUNE = 16 * 256;

/**
 * Expires, as the core would have, all but the newest blocks already past retention: enough for
 * the tick at startup and the one a minute later to each delete a full `PRUNE`. The wall clock is
 * weeks past the file's end, and without this every tick for ten minutes would.
 */
export function trim(file: string, horizon: number): void {
  const db = new Database(file);

  try {
    db.run(
      `DELETE FROM block WHERE hour < ?1 AND (device, series, hour) NOT IN (
         SELECT device, series, hour FROM block WHERE hour < ?1 ORDER BY hour DESC LIMIT ?2
       )`,
      [horizon, 2 * PRUNE],
    );
    // Each step frees one page, as the core returns free pages to the file system.
    db.query("PRAGMA incremental_vacuum").all();
  } finally {
    db.close();
  }
}

/** Throws when anything listens on `port`: the core would reach a device there. */
export async function unreachable(port: number): Promise<void> {
  try {
    const socket = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {} } });

    socket.end();
  } catch (error) {
    // Only a refusal proves nothing listens; any other failure says nothing.
    if (error instanceof Error && "code" in error && error.code === "ECONNREFUSED") return;

    throw error;
  }

  throw new Error(`127.0.0.1:${port} answers: a device would be reached`);
}

/** Drops the stored clear-sky index, so the next start computes it over the full history. */
export function forgetIndex(file: string): void {
  const db = new Database(file);
  const series = "(SELECT id FROM series WHERE name = 'weather.clearness')";

  for (const table of ["block", "rollup_hour", "rollup_day", "hot"])
    db.run(`DELETE FROM ${table} WHERE device = ${WEATHER} AND series = ${series}`);
  db.close();
}

/**
 * The end of the last hour the clear-sky index holds, in ms since 1970; `NaN` with none. Hours
 * past retention get blocks but no rollups.
 */
export function indexReach(file: string): number {
  const db = new Database(file);

  try {
    const own = `device = ${WEATHER}
      AND series = (SELECT id FROM series WHERE name = 'weather.clearness')`;

    const sql = `SELECT max(hour) AS n FROM (
      SELECT hour FROM block WHERE ${own} UNION ALL SELECT hour FROM rollup_hour WHERE ${own})`;

    return (number(db, sql) + 1) * HOUR;
  } finally {
    db.close();
  }
}

/** The store's size on disk, its WAL included. */
export async function sizeOf(data: string): Promise<number> {
  const [store, wal] = [
    Bun.file(join(data, "core.sqlite")),
    Bun.file(join(data, "core.sqlite-wal")),
  ];

  return store.size + ((await wal.exists()) ? wal.size : 0);
}

/** The migrations the core applies: the schema version a current file is at. */
export async function currentSchema(): Promise<number> {
  const dir = join(ROOT, "crates/core/src/storage/migrations");

  return (await Array.fromAsync(new Bun.Glob("*.sql").scan(dir))).length;
}

/** A free loopback port, never the live core's. */
export function freePort(): number {
  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = server;

  server.stop(true);

  return port === 8099 || port === 8199 ? freePort() : port;
}
