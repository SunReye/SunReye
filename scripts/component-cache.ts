// Per-file greens for the component tests (ADR 13): a file whose own inputs (it, everything it
// imports however deep, and what every file shares) hash as on its last green run is not run again.
// A file that reaches a module the import graph cannot follow has no key and always runs. The
// greens live in the git common dir, so every worktree shares them.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Glob } from "bun";
import { commonDir } from "./gate-cache.ts";
import type { ImportGraph } from "./reachable.ts";
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

/** What every component test reads besides its own imports: config, setup, messages, assets. */
const SHARED = [
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "apps/home/web/{package.json,tsconfig.json,components.json,vite.config.ts}",
  "apps/home/web/{browser-commands.ts,scene-tests.ts,touch-tests.ts}",
  "apps/home/web/src/{app.html,app.css,page.setup.ts}",
  "apps/home/web/{messages,static,project.inlang}/**",
  "packages/builder/messages/**",
  "packages/tokens/*.css",
  "packages/*/package.json",
  "scripts/{components,component-cache,reachable,reachable-fs}.ts",
];

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

/** The component tests' greens under `root`, for a run with `options`. */
export function componentCache(root: string, options: readonly string[]) {
  const graph = buildImportGraph(root);
  const hashOf = contents(root);
  const files = SHARED.flatMap((pattern) => Array.from(new Glob(pattern).scanSync(root)));
  const setup = fileKey("apps/home/web/src/page.setup.ts", graph, hashOf, "") ?? "open";

  const shared = sha(
    [
      Bun.version,
      setup,
      ...options,
      ...files.toSorted().map((file) => `${file}\0${hashOf(file)}`),
    ].join("\0"),
  );

  const dir = join(commonDir(root), "gate-cache", "components");
  const keyOf = (file: string) => fileKey(file, graph, hashOf, shared);
  const recordOf = (file: string) => join(dir, sha(file));

  return {
    /** The files of `picks` (repo-relative) to run. */
    async stale(picks: readonly string[]): Promise<string[]> {
      const green = new Map(
        await Promise.all(
          picks.map(
            async (file) =>
              [file, await readFile(recordOf(file), "utf8").catch(() => null)] as const,
          ),
        ),
      );

      return stale(picks, keyOf, (file) => green.get(file) ?? null);
    },
    /** Keeps `ran` (repo-relative) as green with their inputs as they are now. */
    async save(ran: readonly string[]): Promise<void> {
      await mkdir(dir, { recursive: true });
      await Promise.all(
        ran.flatMap((file) => {
          const key = keyOf(file);

          return key === null ? [] : [writeFile(recordOf(file), key)];
        }),
      );
    },
  };
}
