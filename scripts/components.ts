// The component tests in shards side by side (ADR 13), each a vitest of its own with its own
// browser: the 3D scene starves a browser's one software renderer, not the machine's cores.
// `COMPONENT_SHARDS` sets how many. Arguments before the first option pick the files, as vitest's
// filters do; the options go to each vitest. The files are dealt
// by how long each took last time, so no shard waits on the others.
// `VITE_STARVE_FRAMES=1` withholds the browser's frames from the page (`callbacks.harness.ts`): a
// test that still waits on one fails. The gate does not set it; run it after touching a wait.

import { availableParallelism } from "node:os";
import { Glob } from "bun";
import { SCENE } from "../apps/web/scene-tests.ts";

export interface Timed {
  readonly file: string;
  readonly ms: number;
  /** It draws the scene: a shard runs these one at a time, after the rest. */
  readonly scene: boolean;
}

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
}

/**
 * The files whose path holds one of the arguments before the first option, all without one, and
 * the options: vitest would run every file it is handed that matches no filter, too.
 */
export function picked(files: readonly string[], args: readonly string[]): Picked {
  const first = args.findIndex((arg) => arg.startsWith("-"));
  const filters = args.slice(0, first === -1 ? args.length : first);

  return {
    files: files.filter(
      (file) => filters.length === 0 || filters.some((filter) => file.includes(filter)),
    ),
    options: args.slice(filters.length),
  };
}

/** Each file's time on its last run, in ms, read off vitest's results cache. */
async function lastTimes(web: string): Promise<Map<string, number>> {
  const times = new Map<string, number>();

  for (const path of new Glob("node_modules/.vite/vitest/*/results.json").scanSync(web)) {
    // oxlint-disable-next-line no-await-in-loop -- one cache, rarely more.
    const cache = await Bun.file(`${web}/${path}`).text();

    for (const [, file = "", ms = "0"] of cache.matchAll(
      /"([^"]+\.svelte\.test\.ts)":\{[^}]*"duration":([\d.]+)/gu,
    ))
      times.set(file, Math.max(times.get(file) ?? 0, Number(ms)));
  }

  return times;
}

/** A file never timed counts as a typical one of its kind. */
const UNTIMED_MS = { scene: 10_000, dom: 2000 };

if (import.meta.main) {
  const web = `${import.meta.dirname}/../apps/web`;

  const n = Number(
    process.env["COMPONENT_SHARDS"] ?? Math.max(1, Math.floor(availableParallelism() / 6)),
  );

  const times = await lastTimes(web);

  const scenes = SCENE.map((pattern) => new Glob(pattern));

  const { files: chosen, options } = picked(
    [...new Glob("src/**/*.svelte.test.ts").scanSync(web)],
    process.argv.slice(2),
  );

  const files = chosen.map((file) => {
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a glob, only matched.
    const scene = scenes.some((glob) => glob.match(file));

    return { file, scene, ms: times.get(file) ?? UNTIMED_MS[scene ? "scene" : "dom"] };
  });

  const runs = deal(files, n)
    .filter((shard: readonly string[]) => shard.length > 0)
    .map(
      (shard: readonly string[]) =>
        Bun.spawn(["vitest", "run", ...shard, ...options], {
          cwd: web,
          stdio: ["ignore", "inherit", "inherit"],
        }).exited,
    );

  const codes = await Promise.all(runs);

  process.exitCode = codes.find((code) => code !== 0) ?? 0;
}
