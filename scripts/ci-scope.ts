#!/usr/bin/env bun
/**
 * Which heavy `scripts/ci` steps a change can affect (#488).
 *
 * The rule is "provably unaffected", not "probably fine": a path no rule names, a path shared by
 * every step and an empty diff all select every step. An empty diff means the diff could not be
 * computed, never that nothing changed. A skipped step is cheap; a step skipped over a change that
 * breaks it ships the break.
 *
 * Always run, not listed here: lint, typecheck, unit tests and coverage, mock hygiene, factory
 * tests and the agent-guide check. They are cheap, and they catch what a wrong rule here misses.
 *
 *   bun scripts/ci-scope.ts [--full] [--base REF] [--stdin]   one `step run|skip reason` line per step
 *
 * Paths come from `git diff --name-only <base>...HEAD` plus staged, unstaged and untracked files:
 * the gate runs before the commit. `--stdin` reads them from standard input instead.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const STEPS = ["rust", "build", "budgets", "components", "db", "routes", "e2e"] as const;
export type Step = (typeof STEPS)[number];

export interface Verdict {
  run: boolean;
  reason: string;
}
export type Scope = Record<Step, Verdict>;

interface Rule {
  label: string;
  matches: (path: string) => boolean;
  /** The steps a matching path can affect. */
  steps: readonly Step[] | "all";
}

const dir = (name: string) => ({
  label: `${name}/**`,
  matches: (p: string) => p.startsWith(`${name}/`),
});
const file = (name: string) => ({ label: name, matches: (p: string) => p === name });
const rootMarkdown = {
  label: "*.md",
  matches: (p: string) => !p.includes("/") && p.endsWith(".md"),
};

const RUST: readonly Step[] = ["rust", "routes"];
/** Everything built from or tested against the web app, the TypeScript server and the packages. */
const WEB: readonly Step[] = ["build", "components", "e2e"];
/**
 * Budgets are the release binary's size and resident memory (ADR 0006). Only a dependency or build
 * configuration change moves them; source, web and fixture changes are checked by hand before a
 * release (`bun run test:budgets`).
 */
const BUDGETS: readonly Step[] = ["budgets"];

/**
 * First match wins, so a specific rule sits above the directory rule that contains it. A path is
 * inert only where no heavy step reads it: the step's inputs are the cargo workspace, the web app
 * and its packages, the fixtures, and the scripts that drive them.
 */
const RULES: Rule[] = [
  // Shared: the gate, this table and its helper, and what every step builds from.
  ...[
    "scripts/ci",
    "scripts/ci-scope.ts",
    "scripts/lib/ci-scope.sh",
    "scripts/factory/config.json",
    "package.json",
    "bun.lock",
    "bunfig.toml",
    "tsconfig.json",
    "turbo.json",
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain",
    "rust-toolchain.toml",
  ].map((name) => ({ ...file(name), steps: "all" as const })),
  { ...dir(".cargo"), steps: "all" as const },
  // The manifests and build scripts of every crate set the release build's dependencies and size.
  {
    label: "crates/**/Cargo.toml",
    matches: (p: string) => p.startsWith("crates/") && /(^|\/)(Cargo\.toml|build\.rs)$/.test(p),
    steps: [...RUST, ...BUDGETS],
  },
  {
    label: "scripts/budget*",
    matches: (p: string) => /^scripts\/budget(s|-)[^/]*$/.test(p),
    steps: BUDGETS,
  },
  {
    label: "docs/adr/0006-*",
    matches: (p: string) => /^docs\/adr\/0006-[^/]*$/.test(p),
    steps: BUDGETS,
  },
  // The web client is generated from this snapshot, so it moves the web steps too.
  { ...file("crates/sunreye/openapi_snapshot.json"), steps: [...RUST, ...WEB] },
  // The cargo workspace, its sqlx cache and the oracle corpus its tests, the TypeScript database
  // tests and the real-core browser run all read.
  { ...dir("crates"), steps: RUST },
  { ...dir(".sqlx"), steps: RUST },
  { ...dir("fixtures"), steps: ["rust", "db", "e2e"] },
  { ...dir("apps/web"), steps: WEB },
  // The web app imports the server's types, and the server builds on the packages.
  { ...dir("apps/server"), steps: [...WEB, "db"] },
  { ...dir("packages"), steps: [...WEB, "db"] },
  { ...dir("apps/docs"), steps: ["build"] },
  // Read by no heavy step. Their own tests are unit tests, which always run.
  ...[
    dir("docs"),
    dir("plans"),
    dir(".claude"),
    dir(".agents"),
    dir(".github"),
    dir("nixos"),
    dir("sunreye"),
    dir("sunreye-beta"),
    dir("apps/appliance-cli"),
    dir("scripts/factory"),
    dir("scripts/oracle"),
    rootMarkdown,
    file(".gitignore"),
    file("LICENSE"),
  ].map((rule) => ({ ...rule, steps: [] as Step[] })),
];

/** Every step the same verdict: `--full` and an empty diff, which means the diff was not computed. */
function everyStep(reason: string): Scope {
  return Object.fromEntries(STEPS.map((step) => [step, { run: true, reason }])) as Scope;
}

interface Classified {
  /** The first changed path that selected each step. */
  selectedBy: Partial<Record<Step, string>>;
  /** The rules the changed paths matched, once each, in path order. */
  matched: string[];
}

function classify(paths: readonly string[]): Classified {
  const selectedBy: Classified["selectedBy"] = {};
  const matched: string[] = [];
  const select = (steps: readonly Step[], why: string) => {
    for (const step of steps) selectedBy[step] ??= why;
  };
  for (const path of paths) {
    const rule = RULES.find((r) => r.matches(path));
    if (!rule) select(STEPS, `${path} matches no rule`);
    else if (rule.steps === "all") select(STEPS, `${path} is shared by every step`);
    else {
      select(rule.steps, `${path} matches ${rule.label}`);
      if (!matched.includes(rule.label)) matched.push(rule.label);
    }
  }
  return { selectedBy, matched };
}

export function scopeFor(paths: readonly string[], options: { full?: boolean } = {}): Scope {
  if (options.full) return everyStep("--full");
  if (paths.length === 0) return everyStep("empty diff");

  const { selectedBy, matched } = classify(paths);
  const skipped = { run: false, reason: `changed paths match only ${matched.join(", ")}` };
  return Object.fromEntries(
    STEPS.map((step) => {
      const why = selectedBy[step];
      return [step, why ? { run: true, reason: why } : skipped];
    }),
  ) as Scope;
}

export function formatScope(scope: Scope): string {
  return STEPS.map(
    (step) => `${step} ${scope[step].run ? "run" : "skip"} ${scope[step].reason}`,
  ).join("\n");
}

function git(args: string[], cwd: string): string[] | undefined {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) return undefined;
  return proc.stdout.toString().split("\n").filter(Boolean);
}

/**
 * Every path the gate's tree differs from `base` in: committed since the merge base, staged,
 * unstaged and untracked. An unresolvable base yields none, which selects every step.
 */
export function collectPaths(base: string, cwd: string): string[] {
  const parts = [
    git(["diff", "--name-only", "--no-renames", `${base}...HEAD`], cwd),
    git(["diff", "--name-only", "--no-renames", "HEAD"], cwd),
    git(["ls-files", "--others", "--exclude-standard"], cwd),
  ];
  if (parts.some((part) => part === undefined)) return [];
  return [...new Set(parts.flat() as string[])].sort();
}

const USAGE = "usage: bun scripts/ci-scope.ts [--full] [--base REF] [--stdin]";

interface Args {
  full: boolean;
  stdin: boolean;
  base?: string;
}

function parseArgs(argv: string[]): Args | undefined {
  const args: Args = { full: false, stdin: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--full") args.full = true;
    else if (arg === "--stdin") args.stdin = true;
    else if (arg === "--base" && argv[i + 1]) args.base = argv[++i];
    else return undefined;
  }
  return args;
}

export interface Io {
  stdin(): Promise<string>;
  /** The changed paths of the checkout, against `base` or the configured one. */
  repoPaths(base?: string): string[];
  out(text: string): void;
  err(text: string): void;
}

const realIo: Io = {
  stdin: () => Bun.stdin.text(),
  repoPaths: (base) => {
    const config = JSON.parse(readFileSync(join(import.meta.dir, "factory/config.json"), "utf8"));
    return collectPaths(base ?? `origin/${config.base}`, join(import.meta.dir, ".."));
  },
  out: (text) => console.log(text),
  err: (text) => console.error(text),
};

export async function main(argv: string[], io: Io): Promise<number> {
  const args = parseArgs(argv);
  if (!args) {
    io.err(USAGE);
    return 2;
  }
  const paths = args.stdin
    ? (await io.stdin())
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : io.repoPaths(args.base);
  io.out(formatScope(scopeFor(paths, { full: args.full })));
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2), realIo));
