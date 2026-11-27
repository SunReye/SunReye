// Pure reachability analysis for PR-scoped gate runs: maps changed repo-relative paths to the
// Cargo crates, browser component tests and consumer checks the diff can reach.

import { Glob } from "bun";

export interface CrateNode {
  readonly name: string;
  readonly dir: string;
  readonly deps: readonly string[];
}

export type ReverseGraph = Readonly<Record<string, readonly string[]>>;

export interface PrPlan {
  readonly crates: "all" | readonly string[];
  readonly components: "all" | readonly string[];
  readonly consumer: boolean;
}

const IMPORT_RE =
  /(?:from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|(?:^|[;\n])\s*@?import\s+["']([^"']+)["'])/gu;

/** Extracts static, dynamic, side-effect, and CSS import specifiers from a source file. */
export function extractImports(source: string): string[] {
  const found: string[] = [];

  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2] ?? match[3];

    if (spec !== undefined) found.push(spec);
  }

  return found;
}

/** Every web and package source's imports, and the sources the graph cannot follow. */
export interface ImportGraph {
  /** Each file's imports, repo-relative. */
  readonly imports: Readonly<Record<string, readonly string[]>>;
  /** Files that read others no import names: by a URL computed or resolved at run time. */
  readonly opaque: readonly string[];
}

const URL_RE = /new URL\(\s*["'](\.[^"']+)["']\s*,\s*import\.meta\.url\s*\)/gu;

/** Files named by a literal URL beside the source (`new URL("./x", import.meta.url)`). */
export function urlImports(source: string): string[] {
  const found: string[] = [];

  for (const [, path] of source.matchAll(URL_RE)) if (path !== undefined) found.push(path);

  return found;
}

/** Whether `source` reads a file by a URL it computes or resolves, which no import names. */
export function opaqueSource(source: string): boolean {
  return /import\.meta\.(?:url|resolve)\b/u.test(source.replaceAll(URL_RE, ""));
}

const GLOB_RE = /import\.meta\.glob(?:<[^>]*>)?\(\s*(\[[^\]]*\]|["'][^"']+["'])/gu;

/** The patterns of `import.meta.glob` calls, whose files a bundler imports though none is named. */
export function extractGlobs(source: string): string[] {
  const found: string[] = [];

  for (const [, patterns = ""] of source.matchAll(GLOB_RE)) {
    for (const [, pattern] of patterns.matchAll(/["']([^"']+)["']/gu))
      if (pattern !== undefined) found.push(pattern);
  }

  return found;
}

const GLOBAL_RUST = new Set([
  "Cargo.toml",
  "Cargo.lock",
  "rust-toolchain.toml",
  "clippy.toml",
  "deny.toml",
  "deny.pure.toml",
]);

/**
 * What every component test reads besides its own imports (ADR 13): config, the page setup, the
 * messages, static assets, tokens, the lockfile and the runner. A change here reaches them all.
 */
export const SHARED_WEB_INPUTS: readonly string[] = [
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "apps/home/web/{package.json,tsconfig.json,components.json,vite.config.ts,svelte.config.js}",
  "apps/home/web/{browser-commands.ts,scene-tests.ts,touch-tests.ts}",
  "apps/home/web/src/{app.html,app.css,page.setup.ts}",
  "apps/home/web/{messages,static,project.inlang}/**",
  "packages/builder/{messages,project.inlang}/**",
  "packages/tokens/**",
  "packages/*/package.json",
  "scripts/{components,component-cache,reachable,reachable-fs}.ts",
];

const SHARED_GLOBS = SHARED_WEB_INPUTS.map((pattern) => new Glob(pattern));

function bfsReverse(seeds: readonly string[], reverse: ReverseGraph): Set<string> {
  const visited = new Set(seeds);
  const queue = [...seeds];

  for (const item of queue) {
    for (const dependent of reverse[item] ?? []) {
      if (!visited.has(dependent)) {
        visited.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return visited;
}

function addCratesForFile(
  file: string,
  crates: readonly CrateNode[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- accumulator set.
  seeds: Set<string>,
): void {
  for (const crate of crates) {
    if (file === crate.dir || file.startsWith(`${crate.dir}/`)) seeds.add(crate.name);
  }

  if (file.startsWith("profiles/")) {
    seeds.add("sunreye-profile");
    seeds.add("sunreye-core");
  }

  if (file.startsWith("packages/sdk/") || file === "apps/home/web/src/lib/api/schema.d.ts")
    seeds.add("sunreye-core");
}

function seedCrates(changed: readonly string[], crates: readonly CrateNode[]): string[] {
  const seeds = new Set<string>();

  for (const file of changed) addCratesForFile(file, crates, seeds);

  return [...seeds];
}

/** Workspace crates reachable from `changed` via reverse workspace dependencies. */
export function reachableCrates(
  changed: readonly string[],
  crates: readonly CrateNode[],
): "all" | string[] {
  if (changed.some((file) => GLOBAL_RUST.has(file))) return "all";

  const reverse: Record<string, string[]> = {};

  for (const crate of crates) {
    for (const dep of crate.deps) {
      const list = reverse[dep] ?? [];

      list.push(crate.name);
      reverse[dep] = list;
    }
  }

  return [...bfsReverse(seedCrates(changed, crates), reverse)].toSorted();
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a glob, only matched.
const isGlobalWeb = (file: string): boolean => SHARED_GLOBS.some((glob) => glob.match(file));

function seedWebFiles(changed: readonly string[]): string[] {
  const seeds = new Set(changed);

  for (const file of changed) {
    if (file.startsWith("crates/pv/") || file.startsWith("crates/pv-wasm/"))
      seeds.add("packages/pv-wasm/index.js");

    if (file.startsWith("packages/catalogue/")) seeds.add("packages/catalogue/index.js");
  }

  return [...seeds];
}

const WEB_PREFIX = "apps/home/web/";

/** Every component test loads it first, so what it imports reaches them all. */
const PAGE_SETUP = "apps/home/web/src/page.setup.ts";

/** Component `.svelte.test.ts` paths (relative to `apps/home/web`) reachable from `changed`. */
export function reachableComponents(
  changed: readonly string[],
  reverse: ReverseGraph,
): "all" | string[] {
  if (changed.some((file) => isGlobalWeb(file))) return "all";

  const reached = bfsReverse(seedWebFiles(changed), reverse);

  if (reached.has(PAGE_SETUP)) return "all";

  const tests: string[] = [];

  for (const file of reached) {
    if (file.startsWith(WEB_PREFIX) && file.endsWith(".svelte.test.ts"))
      tests.push(file.slice(WEB_PREFIX.length));
  }

  return tests.toSorted();
}

const touchesConsumer = (file: string): boolean =>
  file.startsWith("packages/") ||
  file.startsWith("crates/pv/") ||
  file.startsWith("crates/pv-wasm/") ||
  file.startsWith("fixtures/consumer/") ||
  file === "package.json" ||
  file === "bun.lock";

/** Computes the full PR test plan from changed repo-relative paths. */
export function planPrTests(
  changed: readonly string[],
  crates: readonly CrateNode[],
  reverse: ReverseGraph,
): PrPlan {
  return {
    crates: reachableCrates(changed, crates),
    components: reachableComponents(changed, reverse),
    consumer: changed.some((file) => touchesConsumer(file)),
  };
}
