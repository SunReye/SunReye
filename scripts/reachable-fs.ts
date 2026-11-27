// Filesystem and git/cargo adapters for `scripts/reachable.ts`.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { Glob } from "bun";
import {
  extractGlobs,
  extractImports,
  opaqueSource,
  urlImports,
  type ImportGraph,
  planPrTests,
  type CrateNode,
  type PrPlan,
  type ReverseGraph,
} from "./reachable.ts";

const EXTENSIONS = ["", ".ts", ".d.ts", ".js", ".svelte", ".css", "/index.ts", "/index.js"];

/** Whether `path` under `root` is a file, not a folder. */
const isFile = (root: string, path: string) =>
  statSync(resolve(root, path), { throwIfNoEntry: false })?.isFile() === true;

function tryResolveFile(root: string, base: string): string | null {
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;

    if (isFile(root, candidate)) return candidate;
  }

  if (base.endsWith(".js")) {
    const ts = `${base.slice(0, -3)}.ts`;

    if (isFile(root, ts)) return ts;
  }

  return null;
}

const WORKSPACE_ENTRIES = new Map<string, string>([
  ["@sunreye/builder", "packages/builder/src/index.ts"],
  ["@sunreye/builder/frame", "packages/builder/src/entries/frame.ts"],
  ["@sunreye/builder/canvas", "packages/builder/src/entries/canvas.ts"],
  ["@sunreye/builder/motion", "packages/builder/src/entries/motion.ts"],
  ["@sunreye/builder/settings", "packages/builder/src/entries/settings.ts"],
  ["@sunreye/builder/controls", "packages/builder/src/entries/controls.ts"],
  ["@sunreye/builder/values", "packages/builder/src/entries/values.ts"],
  ["@sunreye/catalogue", "packages/catalogue/index.js"],
  ["@sunreye/pv-wasm", "packages/pv-wasm/index.js"],
  ["@sunreye/scene", "packages/scene/index.js"],
  ["@sunreye/sdk", "packages/sdk/src/index.ts"],
  ["@sunreye/tokens", "packages/tokens/index.css"],
  ["@sunreye/tokens/tokens.css", "packages/tokens/tokens.css"],
  ["@sunreye/tokens/glass.css", "packages/tokens/glass.css"],
  ["@sunreye/ui/theme.css", "packages/ui/theme.css"],
  ["@sunreye/ui/utils", "packages/ui/src/utils.ts"],
  ["@sunreye/ui/haptics", "packages/ui/src/haptics.ts"],
  ["@sunreye/ui/low-power", "packages/ui/src/low-power.ts"],
  ["@sunreye/ui/track-active", "packages/ui/src/track-active.ts"],
  ["@sunreye/ui/motion/ease", "packages/ui/src/motion/ease.ts"],
  ["@sunreye/ui/motion/token", "packages/ui/src/motion/token.ts"],
]);

/** A workspace package's subpath, as its `package.json` exports it (`@sunreye/pv-wasm/pv.wasm`). */
function packageExport(root: string, spec: string): string | null {
  const [, name = "", sub = ""] = /^@sunreye\/([^/]+)\/(.+)$/u.exec(spec) ?? [];
  const manifest = resolve(root, "packages", name, "package.json");

  if (name === "" || !existsSync(manifest)) return null;

  const quoted = `"./${sub.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}"`;

  const exported = new RegExp(
    `${quoted}\\s*:\\s*(?:"([^"]+)"|\\{[^}]*"default"\\s*:\\s*"([^"]+)")`,
    "u",
  );

  const [, plain, conditional] = exported.exec(readFileSync(manifest, "utf8")) ?? [];
  const target = plain ?? conditional;

  return target === undefined ? null : posix.join("packages", name, target);
}

function resolveSpecifier(root: string, importer: string, spec: string): string | null {
  const exact = WORKSPACE_ENTRIES.get(spec);

  if (exact !== undefined) return exact;

  const exported = packageExport(root, spec);

  if (exported !== null) return exported;

  if (spec.startsWith("@sunreye/ui/"))
    return tryResolveFile(root, `packages/ui/src/${spec.slice("@sunreye/ui/".length)}`);

  if (spec.startsWith("#lib/") || spec.startsWith("$lib/"))
    return tryResolveFile(root, `apps/home/web/src/lib/${spec.slice(5)}`);

  if (spec.startsWith("."))
    return tryResolveFile(root, posix.normalize(posix.join(dirname(importer), spec)));

  return null;
}

const GRAPH_GLOBS = [
  "apps/home/web/src/**/*.{ts,js,svelte,css}",
  "packages/*/src/**/*.{ts,js,svelte,css}",
  "packages/*/*.{ts,js,css}",
];

/** A specifier that names a file of this workspace rather than an installed package. */
const isLocal = (spec: string): boolean =>
  spec.startsWith(".") || /^(?:\$lib|#lib|@sunreye)\//u.test(spec) || WORKSPACE_ENTRIES.has(spec);

interface FileImports {
  readonly targets: readonly string[];
  /** It reads a file no import names, or imports one the graph cannot resolve. */
  readonly opaque: boolean;
}

function fileImports(root: string, file: string): FileImports {
  const source = readFileSync(resolve(root, file), "utf8");
  const patterns = extractGlobs(source);

  const globbed = patterns.flatMap((pattern) =>
    pattern.startsWith(".")
      ? Array.from(new Glob(posix.normalize(posix.join(dirname(file), pattern))).scanSync(root))
      : [],
  );

  // A query (`?raw`, `?url`) asks for the same file in another form.
  const specs = [...extractImports(source), ...urlImports(source)].map((spec) =>
    spec.replace(/\?.*$/u, ""),
  );

  const resolved = specs.map((spec) => resolveSpecifier(root, file, spec));
  const lost = specs.some((spec, i) => isLocal(spec) && resolved[i] === null);

  return {
    targets: [...resolved.filter((target) => target !== null), ...globbed],
    opaque: opaqueSource(source) || lost || patterns.some((pattern) => !pattern.startsWith(".")),
  };
}

/** Every web and package source's imports, and the sources the graph cannot follow. */
export function buildImportGraph(root: string): ImportGraph {
  const imports: Record<string, string[]> = {};
  const opaque: string[] = [];

  for (const pattern of GRAPH_GLOBS) {
    for (const file of new Glob(pattern).scanSync(root)) {
      const found = fileImports(root, file);

      imports[file] = [...found.targets];

      if (found.opaque) opaque.push(file);
    }
  }

  return { imports, opaque };
}

/** Builds the reverse import graph (`dependency -> importers`) across web and packages. */
export function buildReverseGraph(root: string): ReverseGraph {
  const reverse: Record<string, string[]> = {};

  for (const [file, targets] of Object.entries(buildImportGraph(root).imports)) {
    for (const target of targets) (reverse[target] ??= []).push(file);
  }

  return reverse;
}

function workspaceMemberDirs(root: string): string[] {
  const toml = readFileSync(resolve(root, "Cargo.toml"), "utf8");
  const match = /members\s*=\s*\[([^\]]+)\]/su.exec(toml);

  if (match?.[1] === undefined) return [];

  const dirs: string[] = [];

  for (const [, pattern = ""] of match[1].matchAll(/"([^"]+)"/gu)) {
    for (const manifest of new Glob(`${pattern}/Cargo.toml`).scanSync(root))
      dirs.push(manifest.replace(/\/Cargo\.toml$/u, ""));
  }

  return dirs.toSorted();
}

interface Manifest {
  readonly dir: string;
  readonly text: string;
}

/** Reads workspace crate directories and intra-workspace dependencies from Cargo manifests. */
export function loadCargoCrates(root: string): CrateNode[] {
  const manifests: readonly Manifest[] = workspaceMemberDirs(root).map((dir) => ({
    dir,
    text: readFileSync(resolve(root, dir, "Cargo.toml"), "utf8"),
  }));

  const names = new Set(
    manifests.flatMap((manifest: Readonly<Manifest>) => {
      const name = /^name\s*=\s*"([^"]+)"/mu.exec(manifest.text)?.[1];

      return name === undefined ? [] : [name];
    }),
  );

  return manifests.flatMap((manifest: Readonly<Manifest>) => {
    const name = /^name\s*=\s*"([^"]+)"/mu.exec(manifest.text)?.[1];

    if (name === undefined) return [];

    const deps = new Set<string>();

    for (const [, dep = ""] of manifest.text.matchAll(/^([a-z0-9_-]+)\s*=/gmu)) {
      if (dep !== name && names.has(dep)) deps.add(dep);
    }

    return [{ name, dir: manifest.dir, deps: [...deps].toSorted() }];
  });
}

function gitLines(root: string, args: readonly string[]): string[] {
  const run = Bun.spawnSync(["git", ...args], { cwd: root });

  if (run.exitCode !== 0)
    throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(run.stderr).trim()}`);

  return new TextDecoder().decode(run.stdout).split("\0").filter(Boolean);
}

/**
 * The merge-base for a PR diff (explicit `--base`, `GITHUB_BASE_REF`, or `staging`); undefined when
 * none resolves, as a diff against HEAD alone would scope the run to almost nothing.
 */
export function resolveBaseRef(root: string, explicit?: string): string | undefined {
  const ghBase = process.env["GITHUB_BASE_REF"];
  const ghRef = ghBase !== undefined && ghBase.length > 0 ? `origin/${ghBase}` : undefined;

  const candidates = (
    explicit === undefined ? [ghRef, "origin/staging", "staging"] : [explicit]
  ).filter((ref): ref is string => ref !== undefined && ref.length > 0);

  for (const ref of candidates) {
    const run = Bun.spawnSync(["git", "merge-base", ref, "HEAD"], { cwd: root });

    if (run.exitCode === 0) {
      const sha = new TextDecoder().decode(run.stdout).trim();

      if (sha.length > 0) return sha;
    }
  }

  return undefined;
}

/** Repo-relative paths changed since `base`, including uncommitted and untracked working files. */
function changedSinceBase(root: string, base: string): string[] {
  const committed = gitLines(root, ["diff", "--name-only", "-z", base]);
  const untracked = gitLines(root, ["ls-files", "--others", "--exclude-standard", "-z"]);

  return [...new Set([...committed, ...untracked])].toSorted();
}

/** Computes the PR test plan for the current checkout against `base`. */
export function computePrPlan(root: string, base: string): PrPlan {
  return planPrTests(changedSinceBase(root, base), loadCargoCrates(root), buildReverseGraph(root));
}
