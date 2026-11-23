// The one check (ADR 13): serial, cheapest first, stops at the first failure.
// It runs before a merge; hosted CI will run the same command. `--fast` is what the pre-commit
// hook runs: the steps marked fast, which need neither the SPA build nor the core compiled.
// A check whose inputs hash as they did on its last green run is skipped; a step that builds what
// a later one reads always runs; a tool installed outside the lock keys its steps with its version.
// `GATE_FRESH=1` runs every step.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { commonDir, hasher, type Reads } from "./gate-cache.ts";

export type Command = readonly string[];

/** A command and what it reads; without reads it builds for a later step, or asks the network. */
export interface Step {
  readonly run: Command;
  readonly reads?: Reads;
  readonly fast?: true;
}

/** Where green runs are kept, and what a step's inputs hash to; null runs the step every time. */
export interface Cache {
  readonly dir: string;
  readonly key: (step: Readonly<Step>) => string | null | Promise<string | null>;
}

const web = ["bun", "run", "--cwd", "apps/web"];

// The core's tests read the SDK's generated types and the profiles; the SPA's tools read profiles.
const RUST: Reads = {
  paths: [
    "crates",
    "profiles",
    "packages",
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
    "clippy.toml",
    "deny.toml",
    "deny.pure.toml",
  ],
};

const JS: Reads = {
  paths: [
    "apps/web",
    "packages",
    "profiles",
    "tools",
    "fixtures",
    "scripts",
    "package.json",
    "bun.lock",
    "bunfig.toml",
    "tsconfig.json",
    ".oxlintrc.json",
    ".oxfmtrc.json",
    ".fallowrc.json",
  ],
};

const BOTH: Reads = { paths: [...new Set([...JS.paths, ...RUST.paths])] };

/** The core embeds the SPA's build (ADR 11). */
const CORE: Reads = { ...RUST, built: ["apps/web/build"] };
const ALL: Reads = { paths: ["."] };

/** cargo-deny and cargo-shear are installed outside the lock; their versions key their steps. */
const DENY: Reads = { ...RUST, tools: [["cargo", "deny", "--version"]] };
const SHEAR: Reads = { ...RUST, tools: [["cargo", "shear", "--version"]] };

const bans = (dir: string): Command => [
  "cargo",
  "deny",
  "--manifest-path",
  `${dir}/Cargo.toml`,
  "--config",
  "deny.pure.toml",
  "check",
  "bans",
];

const steps: readonly Step[] = [
  // Generates apps/web/.svelte-kit, which oxlint's type-aware mode reads.
  { run: [...web, "sync"], fast: true },
  // The core embeds the SPA's build (ADR 11), so every cargo step needs it.
  { run: [...web, "build"] },
  // Formatting
  { run: ["cargo", "fmt", "--all", "--check"], reads: RUST, fast: true },
  { run: ["rsvelte", "format", "--check"], reads: ALL, fast: true },
  // Lints
  {
    run: ["cargo", "clippy", "--workspace", "--all-targets", "--locked", "--", "-D", "warnings"],
    reads: CORE,
  },
  { run: ["oxlint", "--deny-warnings"], reads: JS, fast: true },
  { run: ["fallow", "--quiet"], reads: JS, fast: true },
  // The kit is the only source of controls (ADR 11).
  { run: ["bun", "scripts/native-controls.ts"], reads: JS, fast: true },
  // A shared behaviour lives in one component (ADR 21, #836).
  { run: ["bun", "scripts/one-owner.ts"], reads: JS, fast: true },
  // Component tests run side by side under load: none waits on the wall clock.
  { run: ["bun", "scripts/fake-time.ts"], reads: JS, fast: true },
  // The built glass keeps its blur in Chromium (#763).
  { run: ["bun", "scripts/built-css.ts"], reads: JS },
  // Asks the advisory database, which changes without a file here changing.
  { run: ["cargo", "deny", "--workspace", "check"] },
  { run: bans("crates/profile-wasm"), reads: DENY },
  { run: bans("crates/pv"), reads: DENY },
  { run: bans("crates/pv-wasm"), reads: DENY },
  { run: bans("packages/catalogue"), reads: DENY },
  { run: ["cargo", "shear"], reads: SHEAR },
  // Types
  { run: ["tsrs", "-p", "tsconfig.json"], reads: JS, fast: true },
  { run: [...web, "check"], reads: JS, fast: true },
  // The generated client types match the core's committed OpenAPI document (ADR 9).
  { run: [...web, "api:check"], reads: BOTH, fast: true },
  // Builds and tests
  { run: ["cargo", "test", "--workspace", "--locked"], reads: CORE },
  {
    run: [
      "cargo",
      "build",
      "--locked",
      "-p",
      "sunreye-pv",
      "-p",
      "sunreye-catalogue",
      "--target",
      "wasm32-unknown-unknown",
    ],
  },
  // The SDK's tests load the WASM from where the package ships it.
  { run: ["bun", "run", "--cwd", "packages/sdk", "wasm"], fast: true },
  // The app's tests load the engine from where @sunreye/pv-wasm ships it.
  { run: ["bun", "run", "--cwd", "packages/pv-wasm", "wasm"], fast: true },
  { run: ["bun", "test"], reads: ALL, fast: true },
  // A second consumer installs the packages by path, builds and runs the builder (ADR 25).
  { run: ["bun", "scripts/consumer.ts"], reads: BOTH },
  { run: [...web, "test:components"], reads: BOTH },
];

const root = new URL("..", import.meta.url).pathname;

const env = {
  ...process.env,
  PATH: `${root}node_modules/.bin:${process.env["PATH"] ?? ""}`,
  // Where sccache is installed, every worktree reuses the dependencies another one compiled.
  RUSTC_WRAPPER: process.env["RUSTC_WRAPPER"] ?? Bun.which("sccache") ?? "",
};

/** The file a step's last green inputs are kept in. */
const recordOf = (cache: Readonly<Cache>, step: Readonly<Step>) =>
  join(cache.dir, createHash("sha256").update(step.run.join("\0")).digest("hex"));

function inputsNow(cache: Cache | undefined, step: Readonly<Step>): Promise<string | null> {
  return Promise.resolve(cache === undefined ? null : cache.key(step));
}

function lastGreen(cache: Readonly<Cache>, step: Readonly<Step>): Promise<string | null> {
  return readFile(recordOf(cache, step), "utf8").catch(() => null);
}

/** The steps a run takes: all of them for the gate, those marked fast for the hook. */
export function chosen(all: readonly Step[], fast: boolean): readonly Step[] {
  return fast ? all.filter((step) => step.fast === true) : all;
}

/** Runs the steps in turn; returns the exit code of the first failure, or 0. */
export async function runGate(remaining: readonly Step[], cache?: Cache): Promise<number> {
  const [step, ...rest] = remaining;

  if (step === undefined) return 0;

  const shown = step.run.join(" ");
  const inputs = await inputsNow(cache, step);

  if (cache !== undefined && inputs !== null && (await lastGreen(cache, step)) === inputs) {
    process.stderr.write(`\n✓ ${shown} (unchanged)\n`);

    return runGate(rest, cache);
  }

  process.stderr.write(`\n▶ ${shown}\n`);

  const code = await Bun.spawn([...step.run], {
    cwd: root,
    env,
    stdio: ["inherit", "inherit", "inherit"],
  }).exited;

  if (code !== 0) return code;

  if (cache !== undefined && inputs !== null) {
    await mkdir(cache.dir, { recursive: true });
    await writeFile(recordOf(cache, step), inputs);
  }

  return runGate(rest, cache);
}

if (import.meta.main) {
  const hash = hasher(root, process.env);

  const key = (step: Readonly<Step>) =>
    step.reads === undefined ? null : hash(step.run.join(" "), step.reads);

  const fast = process.argv.includes("--fast");

  const code = await runGate(
    chosen(steps, fast),
    process.env["GATE_FRESH"] === "1"
      ? undefined
      : { dir: join(commonDir(root), "gate-cache"), key },
  );

  const name = fast ? "fast checks" : "gate";

  process.stderr.write(
    code === 0 ? `\n✓ ${name} green\n` : `\n✗ ${name} red: the last step exited ${code}\n`,
  );
  process.exitCode = code;
}
