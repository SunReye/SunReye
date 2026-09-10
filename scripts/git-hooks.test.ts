/**
 * The hooks, and the one gap between them.
 *
 * `pre-commit` runs lint-staged (oxlint, `oxfmt --write`, the diff-scoped fallow
 * audit) plus the whole suite. It is thorough and it is also skippable: `git
 * commit --no-verify` runs none of it, and there are real reasons to reach for
 * that — the fallow audit is scoped to the merge-base, so on a branch that
 * inherits a finding from master it blocks every commit until the branch fixes
 * debt it did not create.
 *
 * The cost showed up in PR #218: several commits were made with `--no-verify`,
 * with oxlint and oxfmt run BY HAND over the files the author happened to list.
 * Two files were not on that list, and `bunx oxfmt --check` — a gate CI runs
 * over the whole repo — went red on a push, minutes later, for a
 * whitespace difference no reviewer would ever want to read about.
 *
 * So `pre-push` is the backstop: the whole-repo checks, at the one moment that
 * catches every commit regardless of how it was made — a bypassed hook, an
 * amend, a rebase, a squash. It has to stay CHEAP, or it becomes the next thing
 * bypassed; the four commands below total a couple of seconds.
 *
 * This is a source-text test and therefore not coverage (`apps/web/TESTING.md`
 * says why). A hook is shell that only git runs; asserting on its text is the
 * only layer there is.
 */

import { describe, expect, test } from "bun:test";

const REPO = new URL("../", import.meta.url);

async function read(file: string): Promise<string> {
  return await Bun.file(new URL(file, REPO)).text();
}

/** Commands the hook actually runs, with comments stripped. */
function commands(hook: string): string {
  return hook
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

describe("pre-push carries the whole-repo checks a bypassed pre-commit would miss", () => {
  const hook = () => read(".husky/pre-push");

  test("the hook exists and is not empty", async () => {
    expect((await hook()).trim().length).toBeGreaterThan(0);
  });

  // FORMAT IS THE ONE THAT ESCAPED. `oxfmt --write` in lint-staged only ever
  // sees staged files, so a `--no-verify` commit formats nothing at all.
  test("it checks formatting over the whole repo, the way CI does", async () => {
    expect(commands(await hook())).toContain("oxfmt --check");
  });

  test("it lints, runs the suite, and checks mock hygiene", async () => {
    const run = commands(await hook());
    expect(run).toContain("oxlint");
    expect(run).toContain("bun run test");
    expect(run).toContain("test:mocks");
  });

  // The hook and CI must ask the same question, or the hook becomes a
  // reassurance that CI then contradicts — which is exactly the failure it is
  // here to prevent.
  test("every whole-repo command it runs is one CI runs too", async () => {
    const ci = await read(".github/workflows/ci.yml");
    for (const command of ["oxlint", "oxfmt --check", "test:mocks"]) {
      expect(ci).toContain(command);
    }
  });

  // A hook nobody can afford to wait for is a hook that gets `--no-verify`d,
  // and then this file is asserting over something that never runs. The two
  // gates that take minutes are named here as the ones that must NOT be in it.
  test("it stays cheap: no coverage run, no container suites", async () => {
    const run = commands(await hook());
    expect(run).not.toContain("test:coverage");
    expect(run).not.toContain("test:routes");
    expect(run).not.toContain("test:db");
  });
});
