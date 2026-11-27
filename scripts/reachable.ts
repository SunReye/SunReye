// Pure reachability analysis for PR-scoped gate runs: maps changed repo-relative paths to the
// Cargo crates, browser component tests, bun unit suites, and consumer checks the diff can reach.

export interface CrateNode {
  readonly name: string;
  readonly dir: string;
  readonly deps: readonly string[];
}

export type ReverseGraph = Readonly<Record<string, readonly string[]>>;

export interface PrPlan {
  readonly crates: "all" | readonly string[];
  readonly components: "all" | readonly string[];
  readonly bunAll: boolean;
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

const GLOBAL_JS_CONFIG = new Set(["package.json", "bun.lock", "bunfig.toml", "tsconfig.json"]);

const GLOBAL_WEB_FILES = new Set([
  "package.json",
  "bun.lock",
  "apps/home/web/package.json",
  "apps/home/web/vite.config.ts",
  "apps/home/web/svelte.config.js",
  "apps/home/web/tsconfig.json",
  "apps/home/web/src/page.setup.ts",
  "apps/home/web/src/app.css",
  "apps/home/web/src/app.html",
  "apps/home/web/scene-tests.ts",
  "apps/home/web/touch-tests.ts",
  "apps/home/web/browser-commands.ts",
  "scripts/components.ts",
]);

const GLOBAL_WEB_PREFIXES = [
  "apps/home/web/messages/",
  "packages/builder/messages/",
  "packages/tokens/",
];

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

const isGlobalWeb = (file: string): boolean =>
  GLOBAL_WEB_FILES.has(file) || GLOBAL_WEB_PREFIXES.some((prefix) => file.startsWith(prefix));

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

/**
 * What bun tests read from disk rather than import (WASM, profiles, ADRs, messages through the
 * compiled paraglide output), which `bun test --changed` cannot follow: a change here runs them all.
 */
const BUN_READS = [
  "crates/",
  "profiles/",
  "docs/",
  "apps/home/web/messages/",
  "packages/builder/messages/",
];

const BUN_READ_FILES = new Set(["GLOSSARY.md", "AGENTS.md", ...GLOBAL_JS_CONFIG]);

const runsEveryBunTest = (file: string): boolean =>
  BUN_READ_FILES.has(file) || BUN_READS.some((prefix) => file.startsWith(prefix));

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
    bunAll: changed.some((file) => runsEveryBunTest(file)),
    consumer: changed.some((file) => touchesConsumer(file)),
  };
}
