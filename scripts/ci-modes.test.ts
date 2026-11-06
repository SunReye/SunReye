import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `scripts/ci` run for real with stand-in `bun`, `bunx`, `cargo` and `docker` that record their
 * arguments, and a `git` that skips the fetch and keeps the heavy locks in a scratch directory. The
 * stand-ins fail on request, so what is proven is the gate's own contract: which checks each mode
 * runs, and that a failing check fails the gate.
 */

const root = join(import.meta.dir, "..");
let dir: string;

const stub = (name: string, body: string) => {
  writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ci-modes-"));
  const record = `echo "$(basename "$0") $*" >> "$CI_LOG"
[[ -n \${FAIL_ON:-} && "$(basename "$0") $*" == "$FAIL_ON"* ]] && { echo "stub failure: $FAIL_ON"; exit 9; }
exit 0`;
  // The real scope under --full: every step selected.
  stub("bun", `[[ $1 == scripts/ci-scope.ts ]] && exec ${process.execPath} "$@" --full\n${record}`);
  for (const name of ["bunx", "cargo", "docker"]) stub(name, record);
  const git = Bun.which("git");
  stub(
    "git",
    `[[ $1 == fetch ]] && exit 0
[[ $* == *--git-common-dir* ]] && { echo "${dir}"; exit 0; }
exec ${git} "$@"`,
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ci = (flags: string[], failOn = "") => {
  const log = join(dir, `log-${flags.join("")}-${failOn.replace(/\W/g, "_")}`);
  writeFileSync(log, "");
  const proc = Bun.spawnSync(["scripts/ci", ...flags], {
    cwd: root,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CI_LOG: log, FAIL_ON: failOn },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  const calls = readFileSync(log, "utf8").trim().split("\n");
  return {
    code: proc.exitCode,
    out: proc.stdout.toString(),
    calls,
    ran: (call: string) => calls.includes(call),
  };
};

const perPr = [
  "bunx oxlint",
  "bun run check-types",
  "bunx drizzle-kit check",
  "bun run test:factory",
  "bun run test:unit",
  "bun run test:rust",
  "cargo fmt --check",
];
const trainOnly = [
  "bun run test:coverage",
  "bun run test:floor",
  "bun run test:coverage:rust",
  "bun run test:floor:rust",
  "bun run test:budgets",
  "bun run e2e",
  "bun run --cwd apps/web e2e:core",
];

describe("scripts/ci modes", () => {
  test("the per-PR gate runs the plain tests and none of the train-only checks", () => {
    const got = ci([]);
    expect(got.code).toBe(0);
    for (const call of perPr) expect(got.ran(call), call).toBe(true);
    for (const call of trainOnly) expect(got.ran(call), call).toBe(false);
  });

  test("--train runs only the train-only checks, so coverage never repeats a plain test run", () => {
    const got = ci(["--train"]);
    expect(got.code).toBe(0);
    expect(got.out).toContain("== ci green");
    for (const call of trainOnly) expect(got.ran(call), call).toBe(true);
    for (const call of perPr) expect(got.ran(call), call).toBe(false);
  });

  test("--full runs the per-PR checks and the train-only ones, with the tests under coverage only", () => {
    const got = ci(["--full"]);
    expect(got.code).toBe(0);
    for (const call of [...trainOnly, "bunx oxlint", "cargo fmt --check"])
      expect(got.ran(call), call).toBe(true);
    for (const call of ["bun run test:unit", "bun run test:rust"])
      expect(got.ran(call), call).toBe(false);
  });

  test("--e2e adds the browser suites to the per-PR gate, not coverage or budgets", () => {
    const got = ci(["--e2e"]);
    expect(got.code).toBe(0);
    expect(got.ran("bun run e2e")).toBe(true);
    expect(got.ran("bun run test:coverage")).toBe(false);
    expect(got.ran("bun run test:budgets")).toBe(false);
  });

  test("a failing train step fails the train gate and names the step", () => {
    const got = ci(["--train"], "bun run test:floor:rust");
    expect(got.code).not.toBe(0);
    expect(got.out).toContain("FAILED train-rust-coverage");
    expect(got.out).not.toContain("== ci green");
  });

  // The first command of a step: a later command that passes must not mask it.
  test.each([
    ["bun run test:coverage", "train-coverage"],
    ["bun run test:coverage:rust", "train-rust-coverage"],
    ["bun run e2e:types", "train-e2e"],
  ])("a failing %s fails the train gate as %s", (command, step) => {
    const got = ci(["--train"], command);
    expect(got.code).toBe(1);
    expect(got.out).toContain(`FAILED ${step} (exit 9)`);
    expect(got.out).not.toContain("== ci green");
  });

  test("a failing budgets run fails the train gate", () => {
    const got = ci(["--train"], "bun run test:budgets");
    expect(got.code).not.toBe(0);
    expect(got.out).toContain("FAILED train-budgets");
  });
});
