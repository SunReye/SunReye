// The one check (ADR 13): serial, cheapest first, stops at the first failure.
// The pre-commit hook runs it unscoped; hosted CI will run the same command.

export type Command = readonly string[];

const web = ["bun", "run", "--cwd", "apps/web"];

const steps: readonly Command[] = [
  // Generates apps/web/.svelte-kit, which oxlint's type-aware mode reads.
  [...web, "sync"],
  // Formatting
  ["cargo", "fmt", "--all", "--check"],
  ["oxfmt", "--check"],
  [...web, "format:check"],
  // Lints
  ["cargo", "clippy", "--workspace", "--all-targets", "--locked", "--", "-D", "warnings"],
  ["oxlint", "--deny-warnings"],
  ["fallow", "--quiet"],
  ["cargo", "deny", "--workspace", "check"],
  [
    "cargo",
    "deny",
    "--manifest-path",
    "crates/profile-wasm/Cargo.toml",
    "--config",
    "deny.pure.toml",
    "check",
    "bans",
  ],
  [
    "cargo",
    "deny",
    "--manifest-path",
    "crates/pv/Cargo.toml",
    "--config",
    "deny.pure.toml",
    "check",
    "bans",
  ],
  ["cargo", "shear"],
  // Types
  ["tsc", "-p", "tsconfig.json"],
  [...web, "check"],
  // Builds and tests
  ["cargo", "test", "--workspace", "--locked"],
  ["cargo", "build", "--locked", "-p", "sunreye-pv", "--target", "wasm32-unknown-unknown"],
  [
    "cargo",
    "build",
    "--locked",
    "--release",
    "-p",
    "sunreye-profile-wasm",
    "--target",
    "wasm32-unknown-unknown",
  ],
  ["bun", "test"],
  [...web, "test:components"],
];

const root = new URL("..", import.meta.url).pathname;
const env = { ...process.env, PATH: `${root}node_modules/.bin:${process.env["PATH"] ?? ""}` };

/** Runs the commands in turn; returns the exit code of the first failure, or 0. */
export async function runGate(commands: readonly Command[]): Promise<number> {
  const [command, ...rest] = commands;

  if (command === undefined) return 0;

  process.stderr.write(`\n▶ ${command.join(" ")}\n`);

  const code = await Bun.spawn([...command], {
    cwd: root,
    env,
    stdio: ["inherit", "inherit", "inherit"],
  }).exited;

  return code === 0 ? runGate(rest) : code;
}

if (import.meta.main) {
  const code = await runGate(steps);

  process.stderr.write(
    code === 0 ? "\n✓ gate green\n" : `\n✗ gate red: the last step exited ${code}\n`,
  );
  process.exitCode = code;
}
