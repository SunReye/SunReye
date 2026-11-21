import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasher } from "./gate-cache.ts";

let root = "";

beforeEach(async () => {
  root = `${await mkdtemp(join(tmpdir(), "gate-cache-"))}/`;
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  await writeFile(join(root, "a.ts"), "a");
});

afterEach(async () => {
  await rm(root, { recursive: true });
});

const reads = { paths: ["."] };

test("a changed or new file changes what a step's inputs hash to", async () => {
  const before = await hasher(root, {})("step", reads);

  await writeFile(join(root, "a.ts"), "b");

  const changed = await hasher(root, {})("step", reads);

  await writeFile(join(root, "new.ts"), "c");

  expect(changed).not.toBe(before);
  expect(await hasher(root, {})("step", reads)).not.toBe(changed);
});

test("the environment a step reads is part of its inputs; the rest of it is not", async () => {
  const plain = await hasher(root, { HOME: "/a" })("step", reads);

  expect(await hasher(root, { HOME: "/b" })("step", reads)).toBe(plain);
  expect(await hasher(root, { SOURCE_DATE_EPOCH: "1" })("step", reads)).not.toBe(plain);
  expect(await hasher(root, { RUSTFLAGS: "-Dwarnings" })("step", reads)).not.toBe(plain);
  expect(await hasher(root, { DB_TEST_URL: "postgres://x" })("step", reads)).not.toBe(plain);
});
