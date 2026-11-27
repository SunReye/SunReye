// The component tests in shards side by side (ADR 13), each a vitest of its own with its own
// browser: the 3D scene starves a browser's one software renderer, not the machine's cores.
// `COMPONENT_SHARDS` sets how many. Arguments before the first option pick the files, as vitest's
// filters do; the options go to each vitest. The files are dealt by recorded time (committed
// `apps/home/web/component-timings.json` overlaid with vitest's local cache), so no shard waits
// on the others. Pass `--record-timings` to update the committed timings file after a run.
// `VITE_STARVE_FRAMES=1` withholds the browser's frames from the page (`callbacks.harness.ts`): a
// test that still waits on one fails. The gate does not set it; run it after touching a wait.
// `--cache` (the gate's) skips a file whose own inputs hash as on its last green run
// (`component-cache.ts`); `GATE_FRESH=1` runs them all, and keeps their greens.

import { availableParallelism } from "node:os";
import { join } from "node:path";
import { Glob } from "bun";
import { planComponents } from "./component-cache.ts";
import { readEnv } from "./gate-cache.ts";
import { SCENE } from "../apps/home/web/scene-tests.ts";

export interface Timed {
  readonly file: string;
  readonly ms: number;
  /** It draws the scene: a shard runs these one at a time, after the rest. */
  readonly scene: boolean;
}

export type Timings = Readonly<Record<string, number>>;

interface Load {
  readonly scene: number;
  readonly dom: number;
}

type Kind = keyof Load;

const NONE: Load = { scene: 0, dom: 0 };

/** Whether `a` takes a file of `kind` before `b`: less of that kind, or as much and less scene. */
const lighter = (a: Load, b: Load, kind: Kind): boolean =>
  a[kind] < b[kind] || (a[kind] === b[kind] && a.scene < b.scene);

/** The shard that takes the next file of `kind`; the first of equals. */
function lightest(loads: readonly Load[], kind: Kind): number {
  let to = 0;

  for (const [i, load] of loads.entries()) if (lighter(load, loads[to] ?? NONE, kind)) to = i;

  return to;
}

/**
 * Deals `files` to `n` shards, longest first, each to the shard with the least of its kind: the
 * scene files run one after another, so their sum is a shard's time; the rest run side by side
 * before them. A tie goes to the shard with less scene.
 */
export function deal(files: readonly Timed[], n: number): string[][] {
  const dealt = Array.from({ length: n }, (): string[] => []);
  const loads = Array.from({ length: n }, () => NONE);

  for (const kind of ["scene", "dom"] as const) {
    for (const { file, ms } of files
      .filter((t) => t.scene === (kind === "scene"))
      .toSorted((a, b) => b.ms - a.ms)) {
      const to = lightest(loads, kind);
      const load = loads[to] ?? NONE;

      dealt[to]?.push(file);
      loads[to] = { ...load, [kind]: load[kind] + ms };
    }
  }

  return dealt;
}

export interface Picked {
  readonly files: string[];
  /** The arguments for each vitest. */
  readonly options: string[];
  /** Whether to save measured times back to `component-timings.json`. */
  readonly record: boolean;
  /** Whether to skip the files whose own inputs are as on their last green run. */
  readonly cache: boolean;
}

/**
 * The files whose path holds one of the arguments before the first option, all without one, and
 * the options: vitest would run every file it is handed that matches no filter, too.
 */
export function picked(files: readonly string[], args: readonly string[]): Picked {
  const first = args.findIndex((arg) => arg.startsWith("-"));
  const filters = args.slice(0, first === -1 ? args.length : first);
  const rawOptions = args.slice(filters.length);
  const record = rawOptions.includes("--record-timings");
  const cache = rawOptions.includes("--cache");

  return {
    files: files.filter(
      (file) => filters.length === 0 || filters.some((filter) => file.includes(filter)),
    ),
    options: rawOptions.filter((arg) => arg !== "--record-timings" && arg !== "--cache"),
    record,
    cache,
  };
}

/** Merges committed baseline timings with fresher local vitest cache timings. */
export function mergeTimes(recorded: Timings, cached: Timings) {
  return { ...recorded, ...cached };
}

const TIMINGS_FILE = "component-timings.json";

async function readRecordedTimes(web: string): Promise<Record<string, number>> {
  const file = Bun.file(`${web}/${TIMINGS_FILE}`);

  if (!(await file.exists())) return {};

  const text = await file.text();
  const times: Record<string, number> = {};

  for (const [, name = "", ms = "0"] of text.matchAll(/"([^"]+\.svelte\.test\.ts)":\s*([\d.]+)/gu))
    times[name] = Number(ms);

  return times;
}

async function writeRecordedTimes(web: string, times: Timings): Promise<void> {
  const keys = Object.keys(times).toSorted((a, b) => a.localeCompare(b));
  const sorted: Record<string, number> = {};

  for (const key of keys) {
    const ms = times[key];

    if (ms !== undefined) sorted[key] = Math.round(ms);
  }

  await Bun.write(`${web}/${TIMINGS_FILE}`, `${JSON.stringify(sorted, null, 2)}\n`);
}

/** Each file's time on its last run, in ms, read off vitest's results cache. */
async function lastTimes(web: string): Promise<Record<string, number>> {
  const times: Record<string, number> = {};

  for (const path of new Glob("node_modules/.vite/vitest/*/results.json").scanSync(web)) {
    // oxlint-disable-next-line no-await-in-loop -- one cache, rarely more.
    const cache = await Bun.file(`${web}/${path}`).text();

    for (const [, file = "", ms = "0"] of cache.matchAll(
      /"([^"]+\.svelte\.test\.ts)":\{[^}]*"duration":([\d.]+)/gu,
    ))
      times[file] = Math.max(times[file] ?? 0, Number(ms));
  }

  return times;
}

/**
 * How many shards to run: `raw` (`COMPONENT_SHARDS`), else a third of the cores. Anything but a
 * whole number of at least one is refused: no shard would run, and the run would pass.
 */
export function shardCount(raw: string | undefined, cores: number): number {
  if (raw === undefined) return Math.max(1, Math.floor(cores / 3));

  const n = Number(raw);

  if (raw.trim() === "" || !Number.isInteger(n) || n < 1)
    throw new RangeError(`COMPONENT_SHARDS must be a whole number of at least 1, not "${raw}"`);

  return n;
}

const root = join(import.meta.dirname, "..");

/** A file's path from the repo root, where the cache keys it. */
const inRepo = (file: string) => `apps/home/web/${file}`;

/** A file never timed counts as a typical one of its kind. */
const UNTIMED_MS = { scene: 10_000, dom: 2000 };

if (import.meta.main) {
  const web = `${import.meta.dirname}/../apps/home/web`;

  const n = shardCount(process.env["COMPONENT_SHARDS"], availableParallelism());

  const recorded = await readRecordedTimes(web);
  const times = mergeTimes(recorded, await lastTimes(web));

  const scenes = SCENE.map((pattern) => new Glob(pattern));

  const {
    files: picks,
    options,
    record,
    cache,
  } = picked([...new Glob("src/**/*.svelte.test.ts").scanSync(web)], process.argv.slice(2));

  const plan = cache
    ? await planComponents(
        root,
        picks.map((file) => inRepo(file)),
        [...readEnv(process.env), ...options],
        process.env["GATE_FRESH"] === "1",
      )
    : null;

  const rerun = new Set(plan?.run);
  const chosen = plan === null ? picks : picks.filter((file) => rerun.has(inRepo(file)));

  if (plan !== null)
    process.stderr.write(
      `components: ${picks.length - chosen.length} of ${picks.length} unchanged\n`,
    );

  const files = chosen.map((file) => {
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a glob, only matched.
    const scene = scenes.some((glob) => glob.match(file));

    return { file, scene, ms: times[file] ?? UNTIMED_MS[scene ? "scene" : "dom"] };
  });

  const vitestEnv = {
    ...process.env,
    PATH: `${web}/node_modules/.bin:${process.env["PATH"] ?? ""}`,
  };

  const runs = deal(files, n)
    .filter((shard: readonly string[]) => shard.length > 0)
    .map(
      (shard: readonly string[]) =>
        Bun.spawn(["vitest", "run", ...shard, ...options], {
          cwd: web,
          env: vitestEnv,
          stdio: ["ignore", "inherit", "inherit"],
        }).exited,
    );

  const codes = await Promise.all(runs);
  const code = codes.find((c) => c !== 0) ?? 0;

  if (code === 0 && record)
    await writeRecordedTimes(web, mergeTimes(recorded, await lastTimes(web)));

  if (code === 0) await plan?.keep();

  process.exitCode = code;
}
