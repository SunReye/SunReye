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

  test("a step whose exit status cannot be written fails the call and is named", () => {
    const got = sh(`
      boom() { chmod a-w $logs; exit 3; }
      code=0; parallel_lanes $logs boom || code=$?
      chmod u+w $logs
      exit $code`);
    expect(got.code).not.toBe(0);
    expect(got.out).toContain("FAILED boom");
  });

  test("a lane killed while its step runs fails the call and names the step", () => {
    const got = sh(`
      victim() { local me=$BASHPID; kill -9 "$(ps -o ppid= -p "$me")"; }
      fine() { :; }
      parallel_lanes $logs victim fine`);
    expect(got.code).not.toBe(0);
    expect(got.out).toContain("FAILED victim");
  });

  test("a killed lane names the step that was running, not the steps it never started", () => {
    const got = sh(`
      first() { local me=$BASHPID; kill -9 "$(ps -o ppid= -p "$me")"; }
      second() { :; }
      parallel_lanes $logs "first second"`);
    expect(got.code).not.toBe(0);
    expect(got.out).toContain("FAILED first");
    expect(got.out).not.toContain("FAILED second");
  });

  test("a lane that exits non-zero fails the call even when no step file says so", () => {
    const got = sh(`
      run_lane() { return 7; }
      parallel_lanes $logs ""`);
    expect(got.code).not.toBe(0);
  });

  test("run_lane fails after a failing step", () => {
    const got = sh(`
      mkdir -p $logs
      boom() { exit 1; }
      run_lane $logs boom`);
    expect(got.code).not.toBe(0);
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

/**
 * `train_only_steps` is the scheduling `scripts/ci --train` runs: the real `selected` from ci-scope.sh over a
 * hand-set scope, with the `train-*` step functions stubbed to record that they ran.
 */
describe("train_only_steps", () => {
  const steps = [
    "train-coverage",
    "train-rust-coverage",
    "train-budgets",
    "train-e2e",
    "train-e2e-core",
  ];
  /** `skip` maps a scope step to its skip reason; `body` overrides a step function's body. */
  const train = (
    args: string,
    skip: Record<string, string> = {},
    body: Record<string, string> = {},
  ) =>
    sh(`
      source scripts/lib/ci-scope.sh
      ${Object.entries(skip)
        .map(([step, reason]) => `scope_verdict[${step}]=skip; scope_reason[${step}]="${reason}"`)
        .join("\n")}
      ${steps.map((s) => `${s}() { echo ${s} >> $work/ran; ${body[s] ?? ":"}; }`).join("\n")}
      TMPDIR=$work train_only_steps ${args}`);
  const ran = (got: ReturnType<typeof sh>) =>
    existsSync(got.file("ran")) ? readFileSync(got.file("ran"), "utf8").trim().split("\n") : [];

  test("a train runs budgets beside the coverage steps, the browser suites after coverage", () => {
    const got = train(
      "1",
      {},
      {
        "train-budgets": `touch $work/budgets; until [[ -e $work/coverage ]]; do :; done`,
        "train-coverage": `touch $work/coverage; until [[ -e $work/budgets ]]; do :; done`,
      },
    );
    expect(got.code).toBe(0);
    expect(ran(got).filter((s) => s !== "train-budgets")).toEqual([
      "train-coverage",
      "train-rust-coverage",
      "train-e2e",
      "train-e2e-core",
    ]);
    expect(ran(got)).toContain("train-budgets");
  });

  test("a failing train step fails the call, names the step and starts nothing after it in its lane", () => {
    const got = train("1", {}, { "train-rust-coverage": "exit 3" });
    expect(got.code).not.toBe(0);
    expect(got.out).toContain("FAILED train-rust-coverage (exit 3)");
    expect(ran(got)).not.toContain("train-e2e");
    expect(ran(got)).toContain("train-budgets");
  });

  test("a failing budgets step fails the call", () => {
    const got = train("1", {}, { "train-budgets": "exit 1" });
    expect(got.code).not.toBe(0);
    expect(got.out).toContain("FAILED train-budgets (exit 1)");
  });

  test("budgets and Rust coverage skip when the scope says so, with the reason", () => {
    const got = train("1", { budgets: "no web change", rust: "no Rust change" });
    expect(got.code).toBe(0);
    expect(ran(got)).toEqual(["train-coverage", "train-e2e", "train-e2e-core"]);
    expect(got.out).toContain("skip budgets: no web change");
    expect(got.out).toContain("skip rust coverage: no Rust change");
  });

  test("the core browser suite skips only when neither the web nor Rust suites run", () => {
    const got = train("1", {
      e2e: "no web change",
      rust: "no Rust change",
      budgets: "no web change",
    });
    expect(ran(got)).toEqual(["train-coverage"]);
    expect(got.out).toContain("skip e2e: no web change");
    expect(got.out).toContain("skip e2e core: no Rust change");
  });

  test("a Rust change runs the core browser suite without the web one", () => {
    const got = train("1", { e2e: "no web change", budgets: "no web change" });
    expect(ran(got)).toEqual(["train-coverage", "train-rust-coverage", "train-e2e-core"]);
  });

  test("outside a train only the browser suites run", () => {
    const got = train("0");
    expect(got.code).toBe(0);
    expect(ran(got)).toEqual(["train-e2e", "train-e2e-core"]);
  });
});
