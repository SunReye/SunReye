import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `parallel_lanes` runs the train-only steps of `scripts/ci` as lanes: steps of one lane in order, lanes
 * side by side. The steps here are shell functions that only write files, so a wrong schedule shows as
 * a missing file or a deadlock, never as a slow test; the spawn timeout only bounds a hang.
 */

const root = join(import.meta.dir, "..", "..");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs `script` with the helper sourced; `$work` is a scratch directory, `$logs` the log directory. */
const sh = (script: string) => {
  const work = mkdtempSync(join(tmpdir(), "ci-parallel-"));
  dirs.push(work);
  const proc = Bun.spawnSync(
    [
      "bash",
      "-c",
      `set -euo pipefail; cd "${root}"; source scripts/lib/ci-parallel.sh; work=${work}; logs=${work}/logs; ${script}`,
    ],
    { stdout: "pipe", stderr: "pipe", timeout: 30_000 },
  );
  return {
    work,
    code: proc.exitCode,
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
    file: (name: string) => join(work, name),
  };
};

describe("parallel_lanes", () => {
  test("two lanes run at the same time: each step waits for a file only the other writes", () => {
    const got = sh(`
      left() { touch $work/left; until [[ -e $work/right ]]; do :; done; }
      right() { touch $work/right; until [[ -e $work/left ]]; do :; done; }
      parallel_lanes $logs left right`);
    expect(got.code).toBe(0);
  });

  test("the steps of one lane run in order", () => {
    const got = sh(`
      one() { echo one >> $work/order; }
      two() { echo two >> $work/order; }
      three() { echo three >> $work/order; }
      parallel_lanes $logs "one two three"`);
    expect(readFileSync(got.file("order"), "utf8")).toBe("one\ntwo\nthree\n");
  });

  test("a failing step names itself, its exit code and its output, and fails the call", () => {
    const got = sh(`
      boom() { echo explosion; exit 3; }
      parallel_lanes $logs boom`);
    expect(got.code).toBe(1);
    expect(got.out).toContain("FAILED boom (exit 3)");
    expect(got.out).toContain("explosion");
  });

  test("a step stops at its first failing command", () => {
    const got = sh(`
      halfway() { false; touch $work/after; }
      parallel_lanes $logs halfway`);
    expect(got.code).toBe(1);
    expect(existsSync(got.file("after"))).toBe(false);
  });

  test("after a failure its lane starts nothing more, and the other lane still finishes", () => {
    const got = sh(`
      boom() { exit 1; }
      later() { touch $work/later; }
      fine() { touch $work/fine; }
      parallel_lanes $logs "boom later" fine`);
    expect(got.code).toBe(1);
    expect(existsSync(got.file("later"))).toBe(false);
    expect(existsSync(got.file("fine"))).toBe(true);
  });

  test("every failing step is named, not only the first", () => {
    const got = sh(`
      a() { exit 2; }
      b() { exit 4; }
      parallel_lanes $logs a b`);
    expect(got.out).toContain("FAILED a (exit 2)");
    expect(got.out).toContain("FAILED b (exit 4)");
  });

  test("each step writes its own log, and a passing step's output stays out of the failure report", () => {
    const got = sh(`
      fine() { echo quiet-output; }
      boom() { echo loud-output; exit 1; }
      parallel_lanes $logs fine boom`);
    expect(readdirSync(got.file("logs")).sort()).toContain("fine.log");
    expect(readFileSync(got.file("logs/fine.log"), "utf8")).toBe("quiet-output\n");
    expect(readFileSync(got.file("logs/boom.log"), "utf8")).toBe("loud-output\n");
    expect(got.out).toContain("loud-output");
    expect(got.out).not.toContain("quiet-output");
  });

  test("a passing run says each step started and finished", () => {
    const got = sh(`
      fine() { :; }
      parallel_lanes $logs fine`);
    expect(got.code).toBe(0);
    expect(got.out).toContain("start fine");
    expect(got.out).toMatch(/done {2}fine: exit 0, \d+s/);
  });

  test("a step that succeeds after an earlier run's failure is not reported from stale files", () => {
    const got = sh(`
      boom() { exit 1; }
      parallel_lanes $logs boom || true
      boom() { :; }
      parallel_lanes $logs boom`);
    expect(got.code).toBe(0);
  });
});
