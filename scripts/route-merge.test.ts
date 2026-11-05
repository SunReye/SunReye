/**
 * Two branches that each add a route must merge without a conflict.
 *
 * Every route-adding PR once touched the same lines: module and route
 * registration, the route lists. The factory merges the base into each branch, so
 * a conflict there stops the train. This builds a temporary repo from the real
 * files, adds one route on each of two branches at the same spot, and merges.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = new URL("../", import.meta.url).pathname;

const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.org",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "init.defaultBranch=base",
      ...args,
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() };
};

/** Inserts `line` after the first line matching `anchor`: the same gap on every branch. */
const after = (anchor: RegExp, line: (name: string) => string) => (text: string, name: string) => {
  const found = anchor.exec(text);
  if (!found) throw new Error(`anchor ${anchor} not found`);
  const end = found.index + found[0].length;
  return `${text.slice(0, end)}\n${line(name)}${text.slice(end)}`;
};

const chain =
  (...steps: ((text: string, name: string) => string)[]) =>
  (text: string, name: string) =>
    steps.reduce((acc, step) => step(acc, name), text);

/** What adding a route changes in each shared file. */
const ADDING_A_ROUTE: Record<string, (text: string, name: string) => string> = {
  "crates/sunreye/route-access.txt": after(
    /^[A-Z]+ \/\S+ \w+$/m,
    (name) => `GET /api/${name} admin`,
  ),
  "crates/sunreye/src/web/tests.rs": after(/^mod \w+;$/m, (name) => `mod ${name};`),
  "crates/sunreye/src/lib.rs": after(/^pub mod \w+;$/m, (name) => `pub mod ${name};`),
  "crates/sunreye/src/run.rs": after(/^use crate::\w+.*;$/m, (name) => `use crate::${name};`),
  "crates/sunreye/src/web/mod.rs": chain(
    after(/^mod \w+;$/m, (name) => `mod ${name};`),
    after(/^ +\.routes\(routes!\(.*\)\)$/m, (name) => `        .routes(routes!(${name}::read))`),
  ),
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "route-merge-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (root: string, file: string) => readFileSync(join(root, file), "utf8");
const write = (file: string, text: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
};

function branchWith(branch: string, name: string) {
  expect(git(dir, "checkout", "-q", "-b", branch, "base").code).toBe(0);
  for (const [file, edit] of Object.entries(ADDING_A_ROUTE))
    write(file, edit(read(dir, file), name));
  expect(git(dir, "commit", "-q", "-am", `feat: add ${name}`).code).toBe(0);
}

test("two branches that each add a route merge without a conflict", () => {
  git(dir, "init", "-q");
  for (const file of [".gitattributes", ...Object.keys(ADDING_A_ROUTE)])
    write(file, read(REPO, file));
  expect(git(dir, "add", "-A").code).toBe(0);
  expect(git(dir, "commit", "-q", "-m", "base").code).toBe(0);

  branchWith("first", "alpha");
  branchWith("second", "beta");
  git(dir, "checkout", "-q", "first");
  const merged = git(dir, "merge", "--no-edit", "second");

  expect(merged.out).not.toContain("CONFLICT");
  expect(merged.code).toBe(0);
  for (const file of Object.keys(ADDING_A_ROUTE)) {
    const text = read(dir, file);
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
    expect(text).not.toContain("<<<<<<<");
  }
});
