// The pre-commit hook (ADR 13): the checks of what a commit stages, so a commit waits seconds.
// Format and lint read the staged files; types run whole but replay the gate's green cache; tests
// are the bun tests the staged files reach (`bun test --changed`) and `cargo test` of the staged
// crates. Fallow, clippy, cargo deny and shear, the core's tests and the component tests are the
// gate's. In a merge only what the merge resolved counts: the files that differ from both parents.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BOTH, JS, runGate, web, type Step } from "./gate.ts";
import { commonDir, hasher } from "./gate-cache.ts";

const FORMATTED = /\.(?:svelte|[cm]?[jt]s|json|jsonc|md|css|ya?ml|toml|html)$/u;
const LINTED = /\.(?:svelte|[cm]?[jt]s)$/u;

const CRATE = /^(crates\/[^/]+|packages\/catalogue)\/(?:.*\.rs|Cargo\.toml)$/u;

const RUST =
  /^(?:crates\/|packages\/catalogue\/.*\.rs$|Cargo\.(?:toml|lock)$|rust-toolchain\.toml$)/u;

/** The WASM the bun tests load, and the command that builds each. */
const WASM: readonly (readonly [string, Step])[] = [
  ["packages/sdk/dist/profile.wasm", { run: ["bun", "run", "--cwd", "packages/sdk", "wasm"] }],
  ["packages/pv-wasm/dist/pv.wasm", { run: ["bun", "run", "--cwd", "packages/pv-wasm", "wasm"] }],
];

/** The core embeds the SPA's build (ADR 11), which a commit does not make. */
const GATE_ONLY_CRATES = new Set(["sunreye-core"]);

const packages = (names: readonly string[]) => names.flatMap((name) => ["-p", name]);

export interface Staged {
  /** The staged paths, relative to the root. */
  readonly files: readonly string[];
  /** The package name of a crate's directory. */
  readonly crateName: (dir: string) => string;
  /** Whether a built file is there. */
  readonly exists: (path: string) => boolean;
}

/** The hook's steps for what is staged; none when nothing is. */
export function hookSteps(staged: Readonly<Staged>): readonly Step[] {
  const { files } = staged;

  if (files.length === 0) return [];

  const formatted = files.filter((file) => FORMATTED.test(file));
  const linted = files.filter((file) => LINTED.test(file));
  const rust = files.some((file) => RUST.test(file));

  const crates = [
    ...new Set(
      files.flatMap((file) => CRATE.exec(file)?.[1] ?? []).map((dir) => staged.crateName(dir)),
    ),
  ].toSorted();

  const tested = crates.filter((crate) => !GATE_ONLY_CRATES.has(crate));

  return [
    // Generates apps/web/.svelte-kit, which oxlint's type-aware mode reads.
    { run: [...web, "sync"] },
    ...(formatted.length > 0
      ? [{ run: ["rsvelte", "format", "--check", "--no-error-on-unmatched-pattern", ...formatted] }]
      : []),
    ...(crates.length > 0 ? [{ run: ["cargo", "fmt", "--check", ...packages(crates)] }] : []),
    ...(linted.length > 0 ? [{ run: ["oxlint", "--deny-warnings", ...linted] }] : []),
    { run: ["bun", "scripts/native-controls.ts"], reads: JS },
    { run: ["bun", "scripts/one-owner.ts"], reads: JS },
    { run: ["bun", "scripts/fake-time.ts"], reads: JS },
    { run: ["tsrs", "-p", "tsconfig.json"], reads: JS },
    { run: [...web, "check"], reads: JS },
    { run: [...web, "api:check"], reads: BOTH },
    ...WASM.flatMap(([built, step]) => (rust || !staged.exists(built) ? [step] : [])),
    { run: ["bun", "test", "--timeout", "120000", "--changed"] },
    // No import reaches a crate: the tests of the packages that load its WASM stand in.
    ...(rust
      ? [{ run: ["bun", "test", "--timeout", "120000", "packages/pv-wasm", "packages/sdk"] }]
      : []),
    ...(tested.length > 0 ? [{ run: ["cargo", "test", "--locked", ...packages(tested)] }] : []),
  ];
}

const root = new URL("..", import.meta.url).pathname;

function git(...args: readonly string[]): string[] {
  const run = Bun.spawnSync(["git", ...args], { cwd: root });

  return new TextDecoder().decode(run.stdout).split("\0").filter(Boolean);
}

function stagedFiles(): string[] {
  const against = (parent: string) =>
    git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z", parent);

  if (git("rev-parse", "-q", "--verify", "MERGE_HEAD").length === 0) return against("HEAD");

  const theirs = new Set(against("MERGE_HEAD"));

  return against("HEAD").filter((file) => theirs.has(file));
}

function crateName(dir: string): string {
  const manifest = readFileSync(join(root, dir, "Cargo.toml"), "utf8");

  return /^name\s*=\s*"([^"]+)"/mu.exec(manifest)?.[1] ?? dir;
}

if (import.meta.main) {
  const steps = hookSteps({
    files: stagedFiles(),
    crateName,
    exists: (path) => existsSync(join(root, path)),
  });

  if (steps.length === 0) process.stderr.write("hook: nothing staged to check\n");

  const hash = hasher(root, process.env);

  const code = await runGate(
    steps,
    process.env["GATE_FRESH"] === "1"
      ? undefined
      : {
          dir: join(commonDir(root), "gate-cache"),
          key: (step: Readonly<Step>) =>
            step.reads === undefined ? null : hash(step.run.join(" "), step.reads),
        },
  );

  process.stderr.write(
    code === 0 ? "\n✓ hook green\n" : `\n✗ hook red: the last step exited ${code}\n`,
  );
  process.exitCode = code;
}
