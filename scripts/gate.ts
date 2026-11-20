// The one check (ADR 13): serial, cheapest first, stops at the first failure.
// The pre-commit hook runs it unscoped; hosted CI will run the same command.
// A check whose inputs hash as they did on its last green run is skipped; a step that builds what
// a later one reads always runs. `GATE_FRESH=1` runs every step.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { commonDir, hasher, type Reads } from "./gate-cache.ts";

export type Command = readonly string[];

/** Where green runs are kept, and what a step's inputs hash to; null runs the step every time. */
export interface Cache {
  readonly dir: string;
  readonly key: (command: Command) => string | null | Promise<string | null>;
}

const web = ["bun", "run", "--cwd", "apps/web"];

const RUST: Reads = {
  paths: [
    "crates",
    "profiles",
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
    "tools",
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

const BOTH: Reads = { paths: [...JS.paths, ...RUST.paths] };

/** The core embeds the SPA's build (ADR 11). */
const CORE: Reads = { ...RUST, built: ["apps/web/build"] };
const ALL: Reads = { paths: ["."] };

const bans = (crate: string): Command => [
  "cargo",
  "deny",
  "--manifest-path",
  `crates/${crate}/Cargo.toml`,
  "--config",
  "deny.pure.toml",
  "check",
  "bans",
];

/** Each step with what it reads; a step without reads builds for a later one and always runs. */
const steps: readonly (readonly [Command, Reads?])[] = [
  // Generates apps/web/.svelte-kit, which oxlint's type-aware mode reads.
  [[...web, "sync"]],
  // The core embeds the SPA's build (ADR 11), so every cargo step needs it.
  [[...web, "build"]],
  // Formatting
  [["cargo", "fmt", "--all", "--check"], RUST],
  [["oxfmt", "--check"], ALL],
  // Lints
  [["cargo", "clippy", "--workspace", "--all-targets", "--locked", "--", "-D", "warnings"], CORE],
  [["oxlint", "--deny-warnings"], JS],
  [["fallow", "--quiet"], JS],
  // The kit is the only source of controls (ADR 11).
  [["bun", "scripts/native-controls.ts"], JS],
  // A shared behaviour lives in one component (ADR 21, #836).
  [["bun", "scripts/one-owner.ts"], JS],
  // The built glass keeps its blur in Chromium (#763).
  [["bun", "scripts/built-css.ts"], JS],
  [["cargo", "deny", "--workspace", "check"], RUST],
  [bans("profile-wasm"), RUST],
  [bans("pv"), RUST],
  [bans("pv-wasm"), RUST],
  [["cargo", "shear"], RUST],
  // Types
  [["tsc", "-p", "tsconfig.json"], JS],
  [[...web, "check"], JS],
  // The generated client types match the core's committed OpenAPI document (ADR 9).
  [[...web, "api:check"], BOTH],
  // Builds and tests
  [["cargo", "test", "--workspace", "--locked"], CORE],
  [["cargo", "build", "--locked", "-p", "sunreye-pv", "--target", "wasm32-unknown-unknown"]],
  // The SDK's tests load the WASM from where the package ships it.
  [["bun", "run", "--cwd", "packages/sdk", "wasm"]],
  [
    [
      "cargo",
      "build",
      "--locked",
      "--release",
      "-p",
      "sunreye-pv-wasm",
      "--target",
      "wasm32-unknown-unknown",
    ],
  ],
  [["bun", "test"], ALL],
  [[...web, "test:components"], BOTH],
];

const root = new URL("..", import.meta.url).pathname;

const env = {
  ...process.env,
  PATH: `${root}node_modules/.bin:${process.env["PATH"] ?? ""}`,
  // Where sccache is installed, every worktree reuses the dependencies another one compiled.
  RUSTC_WRAPPER: process.env["RUSTC_WRAPPER"] ?? Bun.which("sccache") ?? "",
};

const nameOf = (command: Command) => createHash("sha256").update(command.join("\0")).digest("hex");

function green(cache: Cache | undefined, command: Command): Promise<string | null> {
  return Promise.resolve(cache === undefined ? null : cache.key(command));
}

function remembered(cache: Readonly<Cache>, command: Command): Promise<string | null> {
  return readFile(join(cache.dir, nameOf(command)), "utf8").catch(() => null);
}

/** Runs the commands in turn; returns the exit code of the first failure, or 0. */
export async function runGate(commands: readonly Command[], cache?: Cache): Promise<number> {
  const [command, ...rest] = commands;

  if (command === undefined) return 0;

  const key = await green(cache, command);

  if (cache !== undefined && key !== null && (await remembered(cache, command)) === key) {
    process.stderr.write(`\n✓ ${command.join(" ")} (unchanged)\n`);

    return runGate(rest, cache);
  }

  process.stderr.write(`\n▶ ${command.join(" ")}\n`);

  const code = await Bun.spawn([...command], {
    cwd: root,
    env,
    stdio: ["inherit", "inherit", "inherit"],
  }).exited;

  if (code !== 0) return code;

  if (cache !== undefined && key !== null) {
    await mkdir(cache.dir, { recursive: true });
    await writeFile(join(cache.dir, nameOf(command)), key);
  }

  return runGate(rest, cache);
}

if (import.meta.main) {
  const reads = new Map(steps.map(([command, read]) => [command.join(" "), read]));
  const hash = hasher(root);

  const key = (command: Command) => {
    const read = reads.get(command.join(" "));

    return read === undefined ? null : hash(command.join(" "), read);
  };

  const code = await runGate(
    steps.map(([command]) => command),
    process.env["GATE_FRESH"] === "1"
      ? undefined
      : { dir: join(commonDir(root), "gate-cache"), key },
  );

  process.stderr.write(
    code === 0 ? "\n✓ gate green\n" : `\n✗ gate red: the last step exited ${code}\n`,
  );
  process.exitCode = code;
}
