import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { alreadyProven, CI_JOB_NAMES } from "./ci-already-proven";

const ok = (name: string) => ({ name, status: "completed", conclusion: "success" });

/**
 * Merging a PR into `dev` and then `dev` into `master` runs the whole suite
 * again on a tree that already passed — three full runs for one change, plus a
 * fourth when release-please syncs `master` back. This decides when the push
 * run is that repeat.
 *
 * The evidence has to be the TREE, not the commit: a merge commit is a new sha
 * with identical content. And it has to be the evidence of a real run — a
 * parent whose own checks failed, were cancelled, or never ran proves nothing.
 */
describe("alreadyProven", () => {
  const checks = [ok("Lint, type-check & build"), ok("Test & coverage"), ok("Route smoke")];

  test("an identical tree whose parent passed is proven", () => {
    expect(
      alreadyProven({ headTree: "t1", parentTree: "t1", checks, ciJobNames: ["Route smoke"] }),
    ).toBe(true);
  });

  test("a different tree is never proven", () => {
    expect(
      alreadyProven({ headTree: "t1", parentTree: "t2", checks, ciJobNames: ["Route smoke"] }),
    ).toBe(false);
  });

  test("no parent — an ordinary commit, not a merge — is never proven", () => {
    expect(
      alreadyProven({ headTree: "t1", parentTree: null, checks, ciJobNames: ["Route smoke"] }),
    ).toBe(false);
  });

  test("a failed check on the parent is not evidence", () => {
    expect(
      alreadyProven({
        headTree: "t1",
        parentTree: "t1",
        checks: [
          ok("Test & coverage"),
          { name: "Route smoke", status: "completed", conclusion: "failure" },
        ],
        ciJobNames: ["Route smoke"],
      }),
    ).toBe(false);
  });

  test("a cancelled check on the parent is not evidence", () => {
    expect(
      alreadyProven({
        headTree: "t1",
        parentTree: "t1",
        checks: [{ name: "Route smoke", status: "completed", conclusion: "cancelled" }],
        ciJobNames: ["Route smoke"],
      }),
    ).toBe(false);
  });

  test("a check still running is not evidence", () => {
    expect(
      alreadyProven({
        headTree: "t1",
        parentTree: "t1",
        checks: [{ name: "Route smoke", status: "in_progress", conclusion: null }],
        ciJobNames: ["Route smoke"],
      }),
    ).toBe(false);
  });

  // A layer the PR legitimately skipped (its inputs were untouched) would skip
  // on this push for the same reason — the file list is the same one.
  test("a skipped layer is evidence, as long as something actually ran", () => {
    expect(
      alreadyProven({
        headTree: "t1",
        parentTree: "t1",
        checks: [
          ok("Test & coverage"),
          { name: "Browser tests (shard 1/4)", status: "completed", conclusion: "skipped" },
        ],
        ciJobNames: ["Browser tests (shard 1/4)", "Test & coverage"],
      }),
    ).toBe(true);
  });

  test("a parent with no CI checks at all proves nothing", () => {
    expect(
      alreadyProven({ headTree: "t1", parentTree: "t1", checks: [], ciJobNames: ["Route smoke"] }),
    ).toBe(false);
  });

  test("every check skipped proves nothing — no layer ever executed", () => {
    expect(
      alreadyProven({
        headTree: "t1",
        parentTree: "t1",
        checks: [{ name: "Route smoke", status: "completed", conclusion: "skipped" }],
        ciJobNames: ["Route smoke"],
      }),
    ).toBe(false);
  });

  // Other workflows have their own triggers and their own reasons to be red.
  test("checks from other workflows are ignored", () => {
    expect(
      alreadyProven({
        headTree: "t1",
        parentTree: "t1",
        checks: [
          ok("Test & coverage"),
          { name: "Docker · addon beta", status: "completed", conclusion: "failure" },
        ],
        ciJobNames: ["Test & coverage"],
      }),
    ).toBe(true);
  });
});

/**
 * The names above are evidence keys: a check whose name is not in the list is
 * treated as another workflow's business and ignored. So a renamed job would
 * not break anything loudly — it would quietly stop counting, and a tree would
 * be declared proven on the strength of the layers that still matched.
 */
describe("CI_JOB_NAMES", () => {
  test("lists exactly the jobs this workflow reports", () => {
    const workflow = Bun.YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8")) as {
      jobs: Record<string, { name?: string; strategy?: { matrix?: Record<string, unknown[]> } }>;
    };

    // Job display names, with any matrix expanded the way GitHub renders them.
    const declared = Object.entries(workflow.jobs).flatMap(([id, job]) => {
      const name = job.name ?? id;
      const matrix = job.strategy?.matrix;
      if (!matrix) return [name];
      return Object.entries(matrix).flatMap(([key, values]) =>
        values.map((value) => name.replaceAll(`\${{ matrix.${key} }}`, String(value))),
      );
    });

    expect([...CI_JOB_NAMES].sort()).toEqual([...declared].sort());
  });
});
