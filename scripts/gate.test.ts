import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGate } from "./gate.ts";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gate-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true });
});

function record(mark: string): string[] {
  return ["sh", "-c", `echo ${mark} >> ${join(dir, "log")}`];
}

test("a green gate runs every step in order", async () => {
  const code = await runGate([record("a"), record("b")]);

  expect(code).toBe(0);
  expect(await readFile(join(dir, "log"), "utf8")).toBe("a\nb\n");
});

test("the gate stops at the first failing step and turns red", async () => {
  const code = await runGate([record("a"), ["sh", "-c", "exit 3"], record("c")]);

  expect(code).toBe(3);
  expect(await readFile(join(dir, "log"), "utf8")).toBe("a\n");
});
