import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileIfStale } from "./i18n-compile.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "i18n-compile-"));
  await mkdir(join(root, "project.inlang"), { recursive: true });
  await mkdir(join(root, "messages"), { recursive: true });
  await writeFile(join(root, "project.inlang/settings.json"), '{"baseLocale":"en"}');
  await writeFile(join(root, "messages/en.json"), '{"hello":"hi"}');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("compiles once, skips when inputs and outputs are unchanged, and recompiles on change or missing output", async () => {
  const outdir = join(root, "out");
  let runs = 0;

  const bundle = {
    root,
    outdir,
    outputs: ["messages.js"],
    compile: async () => {
      runs += 1;
      await mkdir(outdir, { recursive: true });
      await writeFile(join(outdir, "messages.js"), `export const n = ${String(runs)};\n`);
    },
  };

  expect(await compileIfStale(bundle)).toBe(true);
  expect(await compileIfStale(bundle)).toBe(false);
  expect(runs).toBe(1);

  await writeFile(join(root, "messages/en.json"), '{"hello":"hey"}');
  expect(await compileIfStale(bundle)).toBe(true);
  expect(runs).toBe(2);

  await rm(join(outdir, "messages.js"));
  expect(await compileIfStale(bundle)).toBe(true);
  expect(runs).toBe(3);
});

test("an output changed since its compile, or a changed compiler, compiles again", async () => {
  const outdir = join(root, "out");
  const lock = join(root, "bun.lock");
  let runs = 0;

  await writeFile(lock, "paraglide 2.0.0");

  const bundle = {
    root,
    outdir,
    outputs: ["messages.js"],
    extra: [lock],
    compile: async () => {
      runs += 1;
      await mkdir(outdir, { recursive: true });
      await writeFile(join(outdir, "messages.js"), "export const n = 1;\n");
    },
  };

  expect(await compileIfStale(bundle)).toBe(true);

  await writeFile(join(outdir, "messages.js"), "damaged");
  expect(await compileIfStale(bundle)).toBe(true);

  await writeFile(lock, "paraglide 2.1.0");
  expect(await compileIfStale(bundle)).toBe(true);
  expect(await compileIfStale(bundle)).toBe(false);
  expect(runs).toBe(3);
});

test("concurrent callers share one compile without racing", async () => {
  const outdir = join(root, "concurrent");
  let runs = 0;

  const bundle = {
    root,
    outdir,
    outputs: ["messages.js"],
    compile: async () => {
      runs += 1;
      await Bun.sleep(30);
      await mkdir(outdir, { recursive: true });
      await writeFile(join(outdir, "messages.js"), "export {};\n");
    },
  };

  const results = await Promise.all(Array.from({ length: 6 }, () => compileIfStale(bundle)));

  expect(runs).toBe(1);
  expect(results.filter(Boolean)).toHaveLength(1);
});
