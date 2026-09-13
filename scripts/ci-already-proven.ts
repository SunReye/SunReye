#!/usr/bin/env bun
/**
 * Has this exact tree already been through CI?
 *
 * One change is currently paid for three or four times: the PR into `dev`, the
 * push that merges it, the `dev` → `master` PR, the push that merges THAT, and
 * the sync back. Every one of those runs the same suite over byte-identical
 * content, because a merge commit is a new sha with an old tree.
 *
 * So the evidence is the tree, and the proof is the parent's own checks. A
 * parent whose run failed, was cancelled, or never happened proves nothing, and
 * neither does a parent where every layer skipped — that is a run in which no
 * layer ever executed. When in doubt this returns false and the suite runs: a
 * wasted run costs minutes, a wrongly skipped one ships a regression.
 */

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface ProvenInput {
  /** Tree of the commit that was just pushed. */
  headTree: string;
  /** Tree of the merged-in parent, or null when this is not a merge. */
  parentTree: string | null;
  /** Check runs reported against that parent. */
  checks: CheckRun[];
  /** Job names belonging to this workflow; everything else is another workflow's business. */
  ciJobNames: string[];
}

/**
 * The check names this workflow reports. Kept here rather than read from the
 * YAML at run time so the decision stays a pure function — and pinned to the
 * real job names by `ci-already-proven.test.ts`, which parses the workflow and
 * fails when the two drift. A name that has drifted would silently stop being
 * counted as evidence, which is the quiet direction of this mistake.
 */
export const CI_JOB_NAMES = [
  "What changed",
  "Tests required",
  "Lint, type-check & build",
  "Browser tests (shard 1/4)",
  "Browser tests (shard 2/4)",
  "Browser tests (shard 3/4)",
  "Browser tests (shard 4/4)",
  "Database query tests",
  "Route smoke",
  "Test & coverage",
];

/** Conclusions that mean "this layer reached a verdict we can stand on". */
const PASSED = new Set(["success", "skipped", "neutral"]);

export function alreadyProven({ headTree, parentTree, checks, ciJobNames }: ProvenInput): boolean {
  if (parentTree === null || parentTree !== headTree) return false;

  const names = new Set(ciJobNames);
  const ours = checks.filter((check) => names.has(check.name));
  if (ours.length === 0) return false;

  const settled = ours.every(
    (check) => check.status === "completed" && PASSED.has(check.conclusion ?? ""),
  );
  if (!settled) return false;

  // At least one layer has to have actually executed. An all-skipped parent is
  // not a green suite, it is an absent one.
  return ours.some((check) => check.conclusion === "success");
}

if (import.meta.main) {
  // The workflow hands over what only git and the API can know; every decision
  // is made above, where it is tested. A malformed payload is a false, not a
  // crash that takes the run with it — and a false only costs a repeat run.
  let proven = false;
  try {
    const argv = Bun.argv;
    const arg = (flag: string) => {
      const index = argv.indexOf(flag);
      return index === -1 ? null : (argv[index + 1] ?? null);
    };

    const checksPath = arg("--checks");
    proven = alreadyProven({
      headTree: arg("--head") ?? "",
      parentTree: arg("--parent"),
      checks: checksPath ? ((await Bun.file(checksPath).json()) as CheckRun[]) : [],
      ciJobNames: CI_JOB_NAMES,
    });
  } catch (error) {
    console.error(`could not decide, running everything: ${(error as Error).message}`);
  }
  console.log(`proven=${proven}`);
}
