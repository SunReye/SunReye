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

export const log = (line: string): void => void process.stderr.write(`bench: ${line}\n`);

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
export async function buildImage(): Promise<string> {
  const sha = await run(["git", "rev-parse", "--short", "HEAD"], ROOT);
  const image = `sunreye-bench:${sha}`;
  const build = ["docker", "build", "--network", "host", "-q", "-f", "packaging/Dockerfile"];

  // The core embeds the SPA's build (ADR 11).
  await run(["bun", "run", "--cwd", "apps/web", "build"], ROOT);
  await run([...build, "--target", "core", "-t", image, "."], ROOT);

  return image;
}

/** Copies the cached file, then drops it from the page cache so the first reads are cold. */
export async function copy(cache: string, data: string): Promise<string> {
  const file = join(data, "core.sqlite");

  await run(["cp", "--reflink=auto", cache, file]);
  await run([
    "dd",
    `of=${file}`,
    "oflag=nocache",
    "conv=notrunc,fdatasync",
    "count=0",
    "status=none",
  ]);

  return file;
}

/** What the copy holds before the core opens it. */
export interface Store {
  readonly version: number;
  /** The end of the last stored hour, in ms since 1970. */
  readonly end: number;
  /** Blocks already past retention, which the first ticks expire. */
  readonly backlog: number;
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
      backlog: number(db, "SELECT count(*) AS n FROM block WHERE hour < ?", horizon),
      ports: connections.map((c) => c.port),
    };
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

/** The end of the last hour the clear-sky index holds, in ms since 1970. */
export function indexReach(file: string): number {
  const db = new Database(file);

  try {
    const sql = `SELECT max(hour) AS n FROM rollup_hour WHERE device = ${WEATHER}
      AND series = (SELECT id FROM series WHERE name = 'weather.clearness')`;

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
