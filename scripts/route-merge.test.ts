/**
 * `.gitattributes` unions `crates/sunreye/route-access.txt`: two branches that each add a route
 * line merge without a conflict. Only the table is unioned. A union keeps both sides of a line that
 * both branches changed, so the table parser must reject what that leaves.
 *
 * Builds a temporary repo from the real table and `.gitattributes`.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseAccess } from "./route-smoke-plan";

const REPO = new URL("../", import.meta.url).pathname;
const TABLE = "crates/sunreye/route-access.txt";

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

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "route-merge-"));
  git(dir, "init", "-q");
  for (const file of [".gitattributes", TABLE]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), readFileSync(join(REPO, file), "utf8"));
  }
  expect(git(dir, "add", "-A").code).toBe(0);
  expect(git(dir, "commit", "-q", "-m", "base").code).toBe(0);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const table = () => readFileSync(join(dir, TABLE), "utf8");

/** A commit on its own branch from `base` that rewrites one exact table line. */
function branch(name: string, edit: (text: string) => string) {
  expect(git(dir, "checkout", "-q", "-b", name, "base").code).toBe(0);
  const text = table();
  const edited = edit(text);
  expect(edited).not.toBe(text);
  writeFileSync(join(dir, TABLE), edited);
  expect(git(dir, "commit", "-q", "-am", name).code).toBe(0);
}

const replace = (from: string, to: string) => (text: string) => {
  expect(text).toContain(`${from}\n`);
  return text.replace(`${from}\n`, `${to}\n`);
};

test("two branches that each add a route line at one spot merge into a table the parser accepts", () => {
  branch(
    "first",
    replace("GET /api/kiosk public", "GET /api/kiosk public\nGET /api/kiosk/alpha admin"),
  );
  branch(
    "second",
    replace("GET /api/kiosk public", "GET /api/kiosk public\nGET /api/kiosk/beta admin"),
  );
  git(dir, "checkout", "-q", "first");
  const merged = git(dir, "merge", "--no-edit", "second");

  expect(merged.out).not.toContain("CONFLICT");
  expect(merged.code).toBe(0);
  const labels = parseAccess(table()).map((route) => route.label);
  expect(labels).toContain("GET /api/kiosk/alpha");
  expect(labels).toContain("GET /api/kiosk/beta");
});

test("two branches that give one route different access merge, and the parser rejects the result", () => {
  branch("first", replace("GET /api/forecast session", "GET /api/forecast admin"));
  branch("second", replace("GET /api/forecast session", "GET /api/forecast key"));
  git(dir, "checkout", "-q", "first");
  const merged = git(dir, "merge", "--no-edit", "second");

  expect(merged.code).toBe(0);
  expect(table()).toContain("GET /api/forecast admin\nGET /api/forecast key\n");
  expect(() => parseAccess(table())).toThrow(/GET \/api\/forecast twice/);
});
