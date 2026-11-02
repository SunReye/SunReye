import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `scripts/rust-gate` runs the Rust steps of the merge gate. A stand-in `cargo` records what it
 * was asked and fails on request, so what is proven is the script's own contract: the steps, their
 * order, and that one failure fails the whole gate before the next step runs.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rust-gate-"));
  const cargo = join(dir, "cargo");
  await writeFile(
    cargo,
    '#!/usr/bin/env bash\necho "$*" >> "$CARGO_LOG"\n[[ "$1" == sqlx && -n "${NO_SQLX:-}" ]] && { echo "error: no such command: sqlx" >&2; exit 101; }\n[[ -n "${FAIL_ON:-}" && "$*" == "$FAIL_ON"* ]] && exit 7\nexit 0\n',
  );
  await chmod(cargo, 0o755);
});

afterEach(() => rm(dir, { recursive: true, force: true }));

async function gate(failOn?: string, noSqlx = false) {
  const log = join(dir, "log");
  const proc = Bun.spawn(["scripts/rust-gate"], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      CARGO_LOG: log,
      FAIL_ON: failOn ?? "",
      NO_SQLX: noSqlx ? "1" : "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  const calls = await readFile(log, "utf8").then(
    (text) => text.trim().split("\n"),
    () => [],
  );
  return { code, calls, stderr };
}

describe("scripts/rust-gate", () => {
  test("runs fmt, the sqlx cache check, clippy and test, in that order, with the gate's flags", async () => {
    const { code, calls } = await gate();
    expect(code).toBe(0);
    expect(calls).toEqual([
      "fmt --check",
      "sqlx --version",
      "sqlx database setup --source crates/sunreye/migrations",
      "sqlx prepare --check --workspace -- --all-targets",
      "clippy --workspace --all-targets -- -D warnings",
      "test --workspace",
    ]);
  });

  test("a stale sqlx cache fails the gate and skips clippy", async () => {
    const { code, calls } = await gate("sqlx prepare");
    expect(code).not.toBe(0);
    expect(calls).toHaveLength(4);
    expect(calls[3]).toBe("sqlx prepare --check --workspace -- --all-targets");
  });

  test("a missing cargo-sqlx fails the gate naming the install command", async () => {
    const { code, calls, stderr } = await gate(undefined, true);
    expect(code).not.toBe(0);
    expect(calls).toEqual(["fmt --check", "sqlx --version"]);
    expect(stderr).toContain("cargo install sqlx-cli --locked");
  });

  test("a failing fmt check fails the gate and stops it", async () => {
    const { code, calls } = await gate("fmt");
    expect(code).not.toBe(0);
    expect(calls).toEqual(["fmt --check"]);
  });

  test("a clippy warning fails the gate and skips the tests", async () => {
    const { code, calls } = await gate("clippy");
    expect(code).not.toBe(0);
    expect(calls).toHaveLength(5);
    expect(calls[4]).toBe("clippy --workspace --all-targets -- -D warnings");
  });

  test("a failing test fails the gate", async () => {
    const { code, calls } = await gate("test");
    expect(code).not.toBe(0);
    expect(calls).toHaveLength(6);
    expect(calls[5]).toBe("test --workspace");
  });
});
