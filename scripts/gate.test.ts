import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGate, type Step } from "./gate.ts";

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
