// Shared changelog vocabulary, so the released changelog (addon-changelog.mjs)
// and the beta changelog (beta-changelog.mjs) can never drift into using
// different section names or a different section order for the same commits.

// conventional-changelog section order; unknown sections sort after these.
// Not exported — callers order sections through categoryRank rather than
// reimplementing the comparison against this list.
const CATEGORY_ORDER = [
  "⚠ BREAKING CHANGES",
  "Features",
  "Bug Fixes",
  "Performance Improvements",
  "Reverts",
  "Documentation",
  "Code Refactoring",
  "Tests",
  "Build System",
  "Continuous Integration",
  "Miscellaneous Chores",
];

/**
 * Conventional-commit type → section heading, matching what release-please
 * renders so a beta entry reads exactly like the release entry it becomes.
 * Types absent here (e.g. `style`) are not surfaced, same as release-please.
 */
export const TYPE_TO_CATEGORY = new Map([
  ["feat", "Features"],
  ["fix", "Bug Fixes"],
  ["perf", "Performance Improvements"],
  ["revert", "Reverts"],
  ["docs", "Documentation"],
  ["refactor", "Code Refactoring"],
  ["test", "Tests"],
  ["build", "Build System"],
  ["ci", "Continuous Integration"],
  ["chore", "Miscellaneous Chores"],
]);

export const BREAKING_CATEGORY = "⚠ BREAKING CHANGES";

/** Sort key for a section heading. */
export function categoryRank(category) {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
