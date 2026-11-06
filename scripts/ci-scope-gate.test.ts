import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STEPS } from "./ci-scope";

/**
 * How `scripts/ci` consumes the scope. What each path selects is proven in ci-scope.test.ts; these
 * prove the shell helper turns a selection into a run or a reported skip, and that the gate and the
 * factory's train gate go through it.
 */

const root = join(import.meta.dir, "..");

/** Runs `script` in bash with the helper sourced and a `step` that only records its label. */
const sh = (script: string, paths = "") => {
  const proc = Bun.spawnSync(
    [
      "bash",
      "-c",
      `set -uo pipefail; cd "${root}"; source scripts/lib/ci-scope.sh; step() { echo "STEP $*"; }; ${script}`,
    ],
    { stdin: new TextEncoder().encode(paths), stdout: "pipe", stderr: "pipe" },
  );
  return {
    code: proc.exitCode,
    out: proc.stdout.toString().trim().split("\n").filter(Boolean),
    err: proc.stderr.toString(),
  };
};

describe("scope helper", () => {
  test("a selected step is opened and reported to the caller as run", () => {
    const got = sh(
      'scope_load --stdin && scoped rust "rust gate" && echo ran',
      "crates/sunreye/src/a.rs\n",
    );
    expect(got.out).toEqual(["STEP rust gate", "ran"]);
  });

  test("a skipped step is not opened, and one line says which rule skipped it", () => {
    const got = sh('scope_load --stdin; scoped rust "rust gate" || echo "code $?"', "docs/a.md\n");
    expect(got.out).toEqual(["skip rust gate: changed paths match only docs/**", "code 1"]);
  });

  test("selected answers without printing", () => {
    const got = sh(
      "scope_load --stdin; selected e2e || echo no-e2e; selected rust && echo rust",
      "crates/sunreye/src/a.rs\n",
    );
    expect(got.out).toEqual(["no-e2e", "rust"]);
  });

  test("--full selects every step", () => {
    const got = sh(
      `scope_load --stdin --full; for s in ${STEPS.join(" ")}; do selected $s && echo $s; done`,
      "docs/a.md\n",
    );
    expect(got.out).toEqual([...STEPS]);
  });

  test("an empty diff selects every step", () => {
    const got = sh(
      `scope_load --stdin; for s in ${STEPS.join(" ")}; do selected $s && echo $s; done`,
    );
    expect(got.out).toEqual([...STEPS]);
  });

  test("a step the scope never named runs", () => {
    expect(sh("scope_load --stdin; selected nonsense && echo run", "docs/a.md\n").out).toEqual([
      "run",
    ]);
  });

  test("a scope that cannot be computed fails the load, so the gate stops instead of skipping", () => {
    const got = sh('scope_load --bogus; echo "code $?"');
    expect(got.out).toEqual(["code 1"]);
    expect(got.err).toContain("usage: bun scripts/ci-scope.ts");
  });
});

describe("scripts/ci", () => {
  const ci = readFileSync(join(root, "scripts/ci"), "utf8");
  const lines = ci.split("\n").map((l) => l.trim());
  const commands = lines.filter((l) => l && !l.startsWith("#"));

  /** The lines of every top-level block that opens with `head` and closes with a bare `fi`. */
  const blocks = (head: string) => {
    const all = ci.split("\n");
    const out: string[] = [];
    for (let open = all.indexOf(head); open >= 0; open = all.indexOf(head, open + 1)) {
      out.push(...all.slice(open + 1, all.indexOf("fi", open)).map((l) => l.trim()));
    }
    expect(out.length, head).toBeGreaterThan(0);
    return out.join("\n");
  };

  test("loads the scope after fetching the base, and passes --full through", () => {
    const load = commands.findIndex((l) => l.startsWith("scope_load"));
    expect(load).toBeGreaterThan(commands.findIndex((l) => l.startsWith("git fetch")));
    expect(commands[load]).toContain('"${full_flags[@]}"');
  });

  test("every scoped step is guarded by the helper", () => {
    for (const step of STEPS) {
      const guards = commands.filter((l) => new RegExp(`\\b(scoped|selected) ${step}\\b`).test(l));
      expect(guards.length, `scripts/ci guards ${step}`).toBeGreaterThan(0);
    }
  });

  test("a guard names a scope step, so a typo cannot run a step forever", () => {
    for (const line of commands) {
      const named = /\b(?:scoped|selected) ([a-z0-9]+)\b/.exec(line)?.[1];
      if (named) expect(STEPS as readonly string[], line).toContain(named);
    }
  });

  test("Android is not part of the gate in any mode", () => {
    expect(commands.join("\n")).not.toMatch(/target-gate|setup-targets|android/i);
  });

  /** The `train-*` step functions: the checks that run once per train, each in a lane with its own log. */
  const trainSteps = () => {
    const all = ci.split("\n");
    const first = all.findIndex((l) => l.startsWith("train-coverage() {"));
    const last = all.findIndex((l) => l.startsWith("train-e2e-core() {"));
    expect(first, "train-coverage").toBeGreaterThan(-1);
    expect(last, "train-e2e-core").toBeGreaterThan(first);
    return all.slice(first, all.indexOf("}", last) + 1).join("\n");
  };

  test("the per-PR checks sit under the per-PR switch, the train-only checks in the train steps", () => {
    const pr = blocks("if ((pr)); then");
    for (const check of [
      "require-tests",
      "oxlint",
      "check-types",
      "drizzle-kit check",
      "test:factory",
    ]) {
      expect(pr, check).toContain(check);
    }
    const train = trainSteps();
    for (const check of ["test:coverage", "test:floor", "test:budgets", "bun run e2e"]) {
      expect(train, check).toContain(check);
    }
    expect(pr).not.toMatch(/test:coverage|test:floor|test:budgets|bun run e2e/);
  });

  test("the train steps run as two lanes: budgets alone, the coverage steps before the browser suite", () => {
    const scheduling = blocks("if ((train || e2e)); then");
    expect(scheduling).toContain('lane_budgets="train-budgets"');
    expect(scheduling).toContain('lane_main="train-coverage"');
    const main = [" train-rust-coverage", " train-e2e", " train-e2e-core"].map((step) =>
      scheduling.indexOf(`lane_main+="${step}"`),
    );
    expect(main.every((at) => at > 0)).toBe(true);
    expect(main).toEqual([...main].sort((a, b) => a - b));
    expect(scheduling).toContain('parallel_lanes "$step_logs" "$lane_budgets" "$lane_main"');
  });

  test("plain tests run only without coverage: coverage replaces them, never repeats them", () => {
    expect(trainSteps()).toContain("bun run test:coverage");
    expect(lines).toContain("if ((!train && pr)); then");
    expect(lines).toContain("if ((!train)); then");
    const plain = commands.filter((l) => /\btest:(unit|rust)\b/.test(l));
    expect(plain).toHaveLength(2);
  });

  test("the train and full flags select the train-only checks, and --all is gone", () => {
    const run = (flag: string) =>
      Bun.spawnSync(["bash", join(root, "scripts/ci"), flag], { stdout: "pipe", stderr: "pipe" });
    const refused = run("--all");
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr.toString()).toContain("usage: scripts/ci [--train] [--full] [--e2e]");
    expect(ci).toContain("--train) pr=0 train=1");
    expect(ci).toContain("--full) train=1 full_flags=(--full)");
  });
});

describe("the train gate", () => {
  const config = JSON.parse(readFileSync(join(root, "scripts/factory/config.json"), "utf8")) as {
    commands: { gate: string[][]; train_gate: string[][] };
  };

  test("runs the per-PR gate, then the train-only checks of scripts/ci", () => {
    expect(config.commands.gate).toEqual([["scripts/ci"]]);
    expect(config.commands.train_gate).toEqual([["scripts/ci", "--train"]]);
  });
});
