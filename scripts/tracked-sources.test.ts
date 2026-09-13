import { describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * A source file that `.gitignore` swallows is invisible in every direction: the
 * editor opens it, the type checker resolves it, the unit suite runs it, and
 * `git status` says the tree is clean — while a clean checkout does not have
 * the file at all. `apps/web/src/lib/build/relativize-fallback.ts` lived that
 * way through a merged PR, because the ignore list carried a bare `build`, and
 * the first sign of it was CI failing on an unresolved import two days later.
 *
 * The check is deliberately narrow: it flags source paths git is CONFIGURED to
 * ignore, not merely ones nobody has added yet. Writing a file before staging
 * it is the normal shape of the TDD loop and must stay green; an ignored source
 * file is a rule that can never be satisfied by remembering to `git add`.
 */

const SOURCE_ROOT = /^(?:apps|packages)\/[^/]+\/(?:src|e2e|db-tests)\/|^scripts\//;
const SOURCE_FILE = /\.(?:ts|tsx|svelte|rs|sql)$/;

/**
 * Paths that are ignored on purpose and hold no hand-written source: generated
 * i18n, generated route types, and the analysis caches tools drop in-tree.
 */
const DELIBERATE = [/\/paraglide\//, /\/\.fallow\//, /\/generated\//, /routeTree\.gen\.ts$/];

function ignoredPaths(): string[] {
  // `--directory` collapses a wholly ignored directory to a single entry, which
  // keeps node_modules from swamping the list and reports a swallowed source
  // directory as the one path that explains it.
  const out = execFileSync(
    "git",
    ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
    { encoding: "buffer" },
  );
  return out.toString("utf8").split("\0").filter(Boolean);
}

/** Every source file git already tracks. */
function trackedSources(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" });
  return out
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((path) => SOURCE_ROOT.test(path) && SOURCE_FILE.test(path))
    .filter((path) => !DELIBERATE.some((allowed) => allowed.test(path)));
}

/**
 * Which of those paths an ignore rule matches anyway. `--no-index` is the whole
 * point: without it git reports nothing for a file it already tracks, so the
 * rule that swallowed the file's neighbours stays invisible once someone force-
 * adds one of them.
 */
function matchedByIgnoreRule(paths: string[]): string[] {
  if (paths.length === 0) return [];
  try {
    const out = execFileSync("git", ["check-ignore", "--no-index", "--stdin", "-z"], {
      input: `${paths.join("\0")}\0`,
    });
    return out.toString("utf8").split("\0").filter(Boolean);
  } catch (error) {
    // check-ignore exits 1 when nothing matched, which is the healthy case —
    // and ONLY that. Swallowing every failure here is how this check quietly
    // became a test that passes because git never ran.
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}

describe("tracked sources", () => {
  test("no source directory or file is hidden by an ignore rule", () => {
    const swallowed = ignoredPaths()
      .filter((path) => SOURCE_ROOT.test(path))
      .filter((path) => path.endsWith("/") || SOURCE_FILE.test(path))
      .filter((path) => !DELIBERATE.some((allowed) => allowed.test(path)));

    expect(swallowed).toEqual([]);
  });

  test("no ignore rule matches a source file that is already tracked", () => {
    expect(matchedByIgnoreRule(trackedSources())).toEqual([]);
  });
});

/**
 * `.gitignore` was only half of it.
 *
 * The build context has its own ignore file, with its own copy of the same
 * mistake: a doubled-star `build` (and `dist`) matches at every depth, so a
 * source directory
 * that happens to carry the name is dropped before `docker build` ever reads it.
 * git then tracks the file, every local check passes, and the image build alone
 * fails — `Cannot find module '../src/lib/build/relativize-fallback'` — which is
 * the same symptom, one layer further out, and traced back to a different file.
 *
 * The rule is about the SHAPE of the pattern: an unanchored bare name matches
 * everything called that, anywhere. This flags one only when a real source
 * directory actually carries the name, so node_modules and .turbo stay
 * quiet while the doubled-star `build` does not.
 */
describe("build context", () => {
  test("no ignore pattern swallows a source directory", () => {
    const patterns = readFileSync(".dockerignore", "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));

    // Directories that exist under a source root, by their bare name.
    const sourceDirs = new Set(
      execSync("git ls-files -z", { encoding: "buffer" })
        .toString("utf8")
        .split("\0")
        .filter((path) => SOURCE_ROOT.test(path))
        .flatMap((path) => path.split("/").slice(0, -1)),
    );

    const swallowed = patterns
      .map((pattern) => ({ pattern, name: pattern.replace(/^\*\*\//, "") }))
      // Anchored (`/build`, `apps/*/build`) and extension patterns are precise by
      // construction; only a bare name reaches everywhere.
      .filter(({ name }) => !name.includes("/") && !name.includes("*"))
      .filter(({ name }) => sourceDirs.has(name));

    expect(swallowed.map(({ pattern }) => pattern)).toEqual([]);
  });
});
