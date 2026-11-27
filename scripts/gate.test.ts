import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chosen, gateSteps, runGate, stepKey, type Step } from "./gate.ts";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gate-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true });
});

function record(mark: string): Step {
  return { run: ["sh", "-c", `echo ${mark} >> ${join(dir, "log")}`] };
}

function quick(mark: string): Step {
  return { ...record(mark), fast: true };
}

test("a green gate runs every step in order", async () => {
  const code = await runGate([record("a"), record("b")]);

  expect(code).toBe(0);
  expect(await readFile(join(dir, "log"), "utf8")).toBe("a\nb\n");
});

test("the gate stops at the first failing step and turns red", async () => {
  const code = await runGate([record("a"), { run: ["sh", "-c", "exit 3"] }, record("c")]);

  expect(code).toBe(3);
  expect(await readFile(join(dir, "log"), "utf8")).toBe("a\n");
});

/** A store kept in the test's folder, keyed by whatever the test says the inputs hash to. */
function cached(inputs: Readonly<{ hash: string }>) {
  return { dir: join(dir, "cache"), key: () => inputs.hash };
}

test("a step whose inputs are unchanged since its last green run is skipped", async () => {
  const inputs = { hash: "one" };

  expect(await runGate([record("a")], cached(inputs))).toBe(0);
  expect(await runGate([record("a")], cached(inputs))).toBe(0);

  expect(await readFile(join(dir, "log"), "utf8")).toBe("a\n");
});

test("a step runs again once its inputs change", async () => {
  const inputs = { hash: "one" };

  await runGate([record("a")], cached(inputs));
  inputs.hash = "two";
  await runGate([record("a")], cached(inputs));

  expect(await readFile(join(dir, "log"), "utf8")).toBe("a\na\n");
});

test("a failed step is never remembered as green", async () => {
  const inputs = { hash: "one" };
  const failing = { run: ["sh", "-c", `echo f >> ${join(dir, "log")}; exit 1`] };

  expect(await runGate([failing], cached(inputs))).toBe(1);
  expect(await runGate([failing], cached(inputs))).toBe(1);

  expect(await readFile(join(dir, "log"), "utf8")).toBe("f\nf\n");
});

test("a step without a key always runs", async () => {
  const store = { dir: join(dir, "cache"), key: () => null };

  await runGate([record("a")], store);
  await runGate([record("a")], store);

  expect(await readFile(join(dir, "log"), "utf8")).toBe("a\na\n");
});

test("the fast run keeps only the steps marked fast, in order", () => {
  const slow = record("slow");
  const first = quick("first");
  const second = quick("second");

  expect(chosen([first, slow, second], true)).toEqual([first, second]);
});

test("a step keys apart from itself in a run that leaves out what it waits for", () => {
  const tests: Step = { id: "test", after: ["build"], run: ["bun", "test"] };

  const build: Step = { id: "build", run: ["vite", "build"] };

  expect(stepKey(tests, [build, tests])).not.toBe(stepKey(tests, [tests]));
  expect(stepKey(tests, [build, tests])).toBe(stepKey(tests, [tests, build]));
});

test("the fast run's bun tests, which skip the SPA build, never stand in for the gate's", () => {
  const all = gateSteps("cache");
  const fast = chosen(all, true);
  const tests = all.find((step) => step.id === "bun-test");

  expect(tests && fast.includes(tests)).toBe(true);
  expect(tests && stepKey(tests, fast)).not.toBe(tests && stepKey(tests, all));
});

test("the docs are checked after the core's tests build the binary they read", () => {
  const docs = gateSteps("cache").find((step) => step.id === "docs");

  expect(docs?.after).toContain("cargo-test");
  expect(docs?.run.join(" ")).toContain("scripts/docs.test.ts");
});

test("the gate's component tests skip the files whose own inputs are as on their last green run", () => {
  const components = gateSteps("cache").find((step) => step.id === "components");

  expect(components?.run).toContain("--cache");
});

test("the gate itself runs every step, fast or not", () => {
  const all = [quick("first"), record("slow")];

  expect(chosen(all, false)).toEqual(all);
});

const waitForFile = (target: string) =>
  `i=0; while [ ! -f ${target} ] && [ $i -lt 200 ]; do sleep 0.01; i=$((i+1)); done; [ -f ${target} ]`;

test("DAG steps without dependencies run in parallel while dependents wait", async () => {
  const aReady = join(dir, "a-ready");
  const bReady = join(dir, "b-ready");
  const done = join(dir, "done");

  // Rendezvous barrier: both steps only finish if they overlap in time; `c` runs only after both.
  const steps: Step[] = [
    {
      id: "a",
      run: ["sh", "-c", `touch ${aReady}; ${waitForFile(bReady)} && echo a >> ${done}`],
    },
    {
      id: "b",
      run: ["sh", "-c", `touch ${bReady}; ${waitForFile(aReady)} && echo b >> ${done}`],
    },
    {
      id: "c",
      after: ["a", "b"],
      run: ["sh", "-c", `wc -l < ${done} >> ${join(dir, "after-count")}`],
    },
  ];

  const code = await runGate(steps);

  expect(code).toBe(0);
  expect((await readFile(join(dir, "after-count"), "utf8")).trim()).toBe("2");
});

test("DAG stops active siblings and skips dependents on first failure", async () => {
  const steps: Step[] = [
    { id: "fail", run: ["sh", "-c", "exit 7"] },
    {
      id: "slow",
      run: ["sh", "-c", `sleep 2; echo slow >> ${join(dir, "log")}`],
    },
    {
      id: "after",
      after: ["fail"],
      run: ["sh", "-c", `echo after >> ${join(dir, "log")}`],
    },
  ];

  const t0 = performance.now();
  const code = await runGate(steps);
  const elapsed = performance.now() - t0;

  expect(code).toBe(7);
  expect(elapsed).toBeLessThan(1000);
  expect(await readFile(join(dir, "log"), "utf8").catch(() => "")).toBe("");
});
