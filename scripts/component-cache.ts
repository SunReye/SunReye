// Per-file greens for the component tests (ADR 13): a file whose own inputs (it, everything it
// imports however deep, what every file shares, and the run's environment and options) hash as on
// its last green run is not run again.
// A file that reaches a module the import graph cannot follow has no key and always runs. The
// greens live in the git common dir, so every worktree shares them.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Glob } from "bun";
import { commonDir } from "./gate-cache.ts";
import { SHARED_WEB_INPUTS, type ImportGraph } from "./reachable.ts";
import { buildImportGraph } from "./reachable-fs.ts";

/** `start` and every file it imports, however deep. */
function reached(start: string, graph: Readonly<ImportGraph>): string[] {
  const seen = new Set([start]);
  const queue = [start];

  for (const file of queue) {
    for (const next of graph.imports[file] ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return [...seen].toSorted();
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the bytes are only read.
const sha = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");

/**
 * What `test`'s inputs hash to: every file it reaches, by `hashOf`, and `shared`; null when it
 * reaches a file the graph cannot follow.
 */
export function fileKey(
  test: string,
  graph: Readonly<ImportGraph>,
  hashOf: (path: string) => string,
  shared: string,
): string | null {
  const files = reached(test, graph);

  if (files.some((file) => graph.opaque.includes(file))) return null;

  return sha([shared, ...files.map((file) => `${file}\0${hashOf(file)}`)].join("\0"));
}

/** The files to run: those with no key, or whose key is not the one of their last green run. */
export function stale(
  files: readonly string[],
  keyOf: (file: string) => string | null,
  lastGreen: (file: string) => string | null,
): string[] {
  return files.filter((file) => {
    const key = keyOf(file);

    return key === null || key !== lastGreen(file);
  });
}

/**
 * What every test shares hashes to: the page setup's key, the run's environment and options, and the
 * shared files with their hashes; null when the page setup has none, so no test can be skipped.
 */
export function sharedKey(
  setup: string | null,
  context: readonly string[],
  files: readonly (readonly [string, string])[],
): string | null {
  if (setup === null) return null;

  const hashed = files.map(([file, hash]) => `${file}\0${hash}`).toSorted();

  return sha([Bun.version, setup, ...context, "\0", ...hashed].join("\0"));
}

/** Each file's content hash under `root`, read once. */
function contents(root: string): (path: string) => string {
  const known = new Map<string, string>();

  return (path) => {
    const file = join(root, path);
    const hash = known.get(path) ?? sha(existsSync(file) ? readFileSync(file) : "gone");

    known.set(path, hash);

    return hash;
  };
}

/** Where a test file's last green key is kept: the git common dir, which every worktree shares. */
function store(root: string) {
  const dir = join(commonDir(root), "gate-cache", "components");
  const recordOf = (file: string) => join(dir, sha(file));

  return {
    read: (file: string) => readFile(recordOf(file), "utf8").catch(() => null),
    async write(keys: readonly (readonly [string, string])[]): Promise<void> {
      await mkdir(dir, { recursive: true });
      await Promise.all(keys.map(([file, key]) => writeFile(recordOf(file), key)));
    },
  };
}

/** Each of `picks`' key now: null when it, or the page setup, reaches a file the graph cannot follow. */
function testKeys(
  root: string,
  picks: readonly string[],
  context: readonly string[],
): Map<string, string | null> {
  const graph = buildImportGraph(root);
  const hashOf = contents(root);

  const files = SHARED_WEB_INPUTS.flatMap((pattern) =>
    Array.from(new Glob(pattern).scanSync(root)),
  );

  const setup = fileKey("apps/home/web/src/page.setup.ts", graph, hashOf, "");

  const shared = sharedKey(
    setup,
    context,
    files.map((file) => [file, hashOf(file)] as const),
  );

  const keys = new Map(
    picks.map((file) => [file, shared === null ? null : fileKey(file, graph, hashOf, shared)]),
  );

  return keys;
}

/**
 * Which of `picks` (repo-relative) to run, and a way to keep them green afterwards. Keys are taken
 * before the run, so a file edited while it runs is not kept as green. `context` is the
 * environment and options the run reads; `all` runs every pick and still keeps their greens.
 */
export async function planComponents(
  root: string,
  picks: readonly string[],
  context: readonly string[],
  all: boolean,
): Promise<{ run: string[]; keep: () => Promise<void> }> {
  const keys = testKeys(root, picks, context);

  const greens = store(root);

  const last = new Map(
    await Promise.all(picks.map(async (file) => [file, await greens.read(file)] as const)),
  );

  const run = all
    ? [...picks]
    : stale(
        picks,
        (file) => keys.get(file) ?? null,
        (file) => last.get(file) ?? null,
      );

  return {
    run,
    keep: () =>
      greens.write(
        run.flatMap((file) => {
          const key = keys.get(file);

          return key === undefined || key === null ? [] : [[file, key] as const];
        }),
      ),
  };
}
