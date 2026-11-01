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
    '#!/usr/bin/env bash\necho "$*" >> "$CARGO_LOG"\n[[ "$1" == "${FAIL_ON:-}" ]] && exit 7\nexit 0\n',
  );
  await chmod(cargo, 0o755);
});

afterEach(() => rm(dir, { recursive: true, force: true }));

async function gate(failOn?: string) {
  const log = join(dir, "log");
  const proc = Bun.spawn(["scripts/rust-gate"], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      CARGO_LOG: log,
      FAIL_ON: failOn ?? "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const calls = await readFile(log, "utf8").then(
    (text) => text.trim().split("\n"),
    () => [],
  );
  return { code, calls };
}

describe("scripts/rust-gate", () => {
  test("runs fmt, clippy and test, in that order, with the gate's flags", async () => {
    const { code, calls } = await gate();
    expect(code).toBe(0);
    expect(calls).toEqual([
      "fmt --check",
      "clippy --workspace --all-targets -- -D warnings",
      "test --workspace",
    ]);
  });

  test("a failing fmt check fails the gate and stops it", async () => {
    const { code, calls } = await gate("fmt");
    expect(code).not.toBe(0);
    expect(calls).toEqual(["fmt --check"]);
  });

  test("a clippy warning fails the gate and skips the tests", async () => {
    const { code, calls } = await gate("clippy");
    expect(code).not.toBe(0);
    expect(calls).toEqual(["fmt --check", "clippy --workspace --all-targets -- -D warnings"]);
  });

  test("a failing test fails the gate", async () => {
    const { code, calls } = await gate("test");
    expect(code).not.toBe(0);
    expect(calls).toHaveLength(3);
  });
});
