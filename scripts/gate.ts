// The one check (ADR 13): dependency-aware parallel DAG, stops and cancels active siblings on the
// first failure. `--fast` runs the steps marked fast, which need neither the SPA build nor the
// core compiled; `--pr` scopes cargo and component tests to what the diff since the base branch
// can reach; the
// pre-commit hook is `scripts/hook.ts`.
// A check whose inputs hash as they did on its last green run is skipped; a step that builds what
// a later one reads always runs; a tool installed outside the lock keys its steps with its version.
// `GATE_FRESH=1` runs every step.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { commonDir, hasher, type Reads } from "./gate-cache.ts";
import { runGate, stepKey, type Cache, type Command, type Step } from "./gate-run.ts";
import type { PrPlan } from "./reachable.ts";
import { computePrPlan, resolveBaseRef } from "./reachable-fs.ts";

export { runGate, stepKey, type Cache, type Command, type Step };

export const web = ["bun", "run", "--cwd", "apps/home/web"];

// The core's tests read the SDK's generated types and the profiles; the SPA's tools read profiles.
const RUST: Reads = {
  paths:
    "crates apps/home/core profiles packages Cargo.toml Cargo.lock rust-toolchain.toml clippy.toml deny.toml deny.pure.toml".split(
      " ",
    ),
};

export const JS: Reads = {
  paths:
    "apps/home/web packages profiles tools fixtures scripts package.json bun.lock bunfig.toml tsconfig.json .oxlintrc.json .oxlintrc.base.json .oxfmtrc.json .fallowrc.json".split(
      " ",
    ),
};

export const BOTH: Reads = { paths: [...new Set([...JS.paths, ...RUST.paths])] };

/** The core embeds the SPA's build (ADR 11). */
const CORE: Reads = { ...RUST, built: ["apps/home/web/build"] };
const ALL: Reads = { paths: ["."] };

/** cargo-deny and cargo-shear are installed outside the lock; their versions key their steps. */
const DENY: Reads = { ...RUST, tools: [["cargo", "deny", "--version"]] };
const SHEAR: Reads = { ...RUST, tools: [["cargo", "shear", "--version"]] };

const bans = (dir: string): Command =>
  `cargo deny --manifest-path ${dir}/Cargo.toml --config deny.pure.toml check bans`.split(" ");

const WASM32 =
  "cargo build --locked -p sunreye-pv -p sunreye-catalogue --target wasm32-unknown-unknown".split(
    " ",
  );

const CLIPPY = "cargo clippy --workspace --all-targets --locked -- -D warnings".split(" ");
const OXLINT = ["oxlint", "-c", ".oxlintrc.base.json", "--deny-warnings"] as const;
const RSVELTE_LINT = ["rsvelte", "lint", "--deny-warnings"] as const;

const PREPARE_STEPS: readonly Step[] = [
  { id: "web-sync", run: [...web, "sync"], fast: true },
  { id: "sdk-wasm", run: ["bun", "run", "--cwd", "packages/sdk", "wasm"], fast: true },
  { id: "pv-wasm", run: ["bun", "run", "--cwd", "packages/pv-wasm", "wasm"], fast: true },
  { id: "web-build", after: ["web-sync", "pv-wasm"], cwd: "apps/home/web", run: ["vite", "build"] },
  { id: "wasm32", run: WASM32 },
];

const CHECK_STEPS: readonly Step[] = [
  { id: "cargo-fmt", run: ["cargo", "fmt", "--all", "--check"], reads: RUST, fast: true },
  { id: "rsvelte-fmt", run: ["rsvelte", "format", "--check"], reads: ALL, fast: true },
  { id: "cargo-clippy", after: ["web-build"], run: CLIPPY, reads: CORE },
  { id: "oxlint", after: ["web-sync"], run: OXLINT, reads: JS, fast: true },
  { id: "rsvelte-lint", after: ["web-sync"], run: RSVELTE_LINT, reads: JS, fast: true },
  { id: "fallow", run: ["fallow", "--quiet"], reads: JS, fast: true },
  { id: "native-controls", run: ["bun", "scripts/native-controls.ts"], reads: JS, fast: true },
  { id: "one-owner", run: ["bun", "scripts/one-owner.ts"], reads: JS, fast: true },
  { id: "fake-time", run: ["bun", "scripts/fake-time.ts"], reads: JS, fast: true },
  { id: "built-css", after: ["web-build"], run: ["bun", "scripts/built-css.ts"], reads: JS },
  { id: "cargo-deny", run: ["cargo", "deny", "--workspace", "check"] },
  { id: "bans-profile-wasm", run: bans("crates/profile-wasm"), reads: DENY },
  { id: "bans-pv", run: bans("crates/pv"), reads: DENY },
  { id: "bans-pv-wasm", run: bans("crates/pv-wasm"), reads: DENY },
  { id: "bans-catalogue", run: bans("packages/catalogue"), reads: DENY },
  { id: "cargo-shear", run: ["cargo", "shear"], reads: SHEAR },
  { id: "tsrs", after: ["web-sync"], run: ["tsrs", "-p", "tsconfig.json"], reads: JS, fast: true },
  {
    id: "web-typecheck",
    after: ["web-sync"],
    cwd: "apps/home/web",
    run: ["rsvelte", "typecheck"],
    reads: JS,
    fast: true,
  },
  { id: "api-check", run: [...web, "api:check"], reads: BOTH, fast: true },
];

/**
 * Every bun test, whatever the scope: they take seconds, and `--changed` cannot follow a file read
 * from disk (WASM, profiles, ADRs, the build).
 */
function bunTestStep(timingsDir: string): Step[] {
  const timings = join(timingsDir, "bun-test-timings.json");

  return [
    {
      id: "bun-test",
      after: ["web-sync", "web-build", "sdk-wasm", "pv-wasm"],
      run: [
        ..."bun test --parallel --no-isolate --timeout 120000".split(" "),
        `--timings=${timings}`,
        "--timings=scripts/bun-test-timings.json",
        "--update-timings",
      ],
      reads: ALL,
      fast: true,
    },
  ];
}

/**
 * The docs' commands, read against the core binary (`docs.test.ts`): built here, as a skipped
 * `cargo test` builds none, and cargo answers at once when it is current.
 */
function docsSteps(): Step[] {
  return [
    {
      id: "core-bin",
      after: ["web-build"],
      run: "cargo build --locked -p sunreye-core --bin sunreye".split(" "),
    },
    {
      id: "docs",
      after: ["core-bin"],
      run: ["bun", "test", "--config=scripts/docs.bunfig.toml", "scripts/docs.test.ts"],
      reads: { ...ALL, built: ["target/debug/sunreye"] },
    },
  ];
}

function cargoTestStep(pr?: Readonly<PrPlan>): Step[] {
  if (pr === undefined || pr.crates === "all") {
    return [
      {
        id: "cargo-test",
        after: ["web-build", "cargo-clippy"],
        run: ["cargo", "test", "--workspace", "--locked"],
        reads: CORE,
      },
    ];
  }

  if (pr.crates.length === 0) return [];

  const needsSpa = pr.crates.includes("sunreye-core") || pr.crates.includes("sunreye-synth");

  return [
    {
      id: "cargo-test",
      after: needsSpa ? ["web-build", "cargo-clippy"] : ["cargo-clippy"],
      run: ["cargo", "test", "--locked", ...pr.crates.flatMap((name) => ["-p", name])],
    },
  ];
}

// Chromium's software WebGL shards starve if launched beside bundlers/compilers/linters; start
// once those finish and overlap cleanly with I/O-bound `cargo test`.
const BEFORE_COMPONENTS = [
  "web-sync",
  "pv-wasm",
  "web-build",
  "oxlint",
  "web-typecheck",
  "bun-test",
  "consumer",
  "cargo-clippy",
] as const;

function componentTestStep(pr?: Readonly<PrPlan>): Step[] {
  if (pr === undefined || pr.components === "all") {
    return [
      {
        id: "components",
        after: BEFORE_COMPONENTS,
        run: ["bun", "scripts/components.ts", "--cache"],
        reads: BOTH,
      },
    ];
  }

  if (pr.components.length === 0) return [];

  return [
    {
      id: "components",
      after: BEFORE_COMPONENTS,
      run: ["bun", "scripts/components.ts", ...pr.components, "--cache"],
    },
  ];
}

function consumerStep(pr?: Readonly<PrPlan>): Step[] {
  if (pr !== undefined && !pr.consumer) return [];

  return [
    {
      id: "consumer",
      after: ["web-sync", "pv-wasm"],
      run: ["bun", "scripts/consumer.ts"],
      reads: BOTH,
    },
  ];
}

export function gateSteps(timingsDir: string, pr?: Readonly<PrPlan>): readonly Step[] {
  return [
    ...PREPARE_STEPS,
    ...CHECK_STEPS,
    ...cargoTestStep(pr),
    ...bunTestStep(timingsDir),
    ...docsSteps(),
    ...consumerStep(pr),
    ...componentTestStep(pr),
  ];
}

/** The steps a run takes: all of them for the gate, those marked fast for the hook. */
export function chosen(all: readonly Step[], fast: boolean): readonly Step[] {
  return fast ? all.filter((step) => step.fast === true) : all;
}

const root = new URL("..", import.meta.url).pathname;

function baseArg(argv: readonly string[]): string | undefined {
  const index = argv.indexOf("--base");

  return index === -1 ? undefined : argv[index + 1];
}

if (import.meta.main) {
  const cacheDir = join(commonDir(root), "gate-cache");
  const hash = hasher(root, process.env);

  const fast = process.argv.includes("--fast");
  const prMode = process.argv.includes("--pr");
  const base = prMode ? resolveBaseRef(root, baseArg(process.argv)) : undefined;

  if (prMode && base === undefined) {
    process.stderr.write("✗ pr gate: no base to diff against; pass --base <ref> or run the gate\n");
    process.exit(2);
  }

  const pr = base === undefined ? undefined : computePrPlan(root, base);

  if (pr !== undefined) {
    const comp = pr.components === "all" ? "all" : `${pr.components.length} file(s)`;
    const crates = pr.crates === "all" ? "all" : pr.crates.join(", ") || "none";

    process.stderr.write(
      `PR scope (${base?.slice(0, 10)}): crates=[${crates}] components=[${comp}]\n`,
    );
  }

  await mkdir(cacheDir, { recursive: true });

  const steps = chosen(gateSteps(cacheDir, pr), fast);

  const key = (step: Readonly<Step>) =>
    step.reads === undefined ? null : hash(stepKey(step, steps), step.reads);

  const cache = process.env["GATE_FRESH"] === "1" ? undefined : { dir: cacheDir, key };
  const code = await runGate(steps, cache);
  const name = fast ? "fast checks" : prMode ? "pr gate" : "gate";

  process.stderr.write(code === 0 ? `\n✓ ${name} green\n` : `\n✗ ${name} red (exit ${code})\n`);
  process.exitCode = code;
}
