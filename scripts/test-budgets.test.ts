import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * bun's default test timeout is 5 seconds, and a layer that talks to a real
 * database inherits it as though someone had chosen it.
 *
 * Nobody did. Twice in one day a db spec crossed it on a shared runner — a
 * different spec each time, neither of them changed by the branch that went red
 * — against a Postgres container seconds old. Measured locally: the same file
 * takes 734ms against a warm database and 2.0s against one that has just
 * finished initdb, and CI machines are slower and busier than this one.
 *
 * The fix belongs to the layer, not to whichever spec is unlucky. A per-test
 * budget added after each flake is a ratchet that never catches up.
 */
const scripts = () =>
  (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> })
    .scripts;

describe("test budgets", () => {
  test("the database layer does not run on bun's default timeout", () => {
    const timeout = /--timeout\s+(\d+)/.exec(scripts()["test:db"] ?? "")?.[1];

    expect(timeout).toBeDefined();
    // Generous on purpose: meaningless when the database is healthy, and still
    // short enough to catch a genuine hang rather than wait out the job.
    expect(Number(timeout)).toBeGreaterThanOrEqual(30_000);
  });
});
