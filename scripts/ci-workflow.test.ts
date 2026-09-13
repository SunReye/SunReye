import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { surfacesFor } from "./ci-surfaces";

/**
 * Gating jobs on another job's outputs fails in one direction only, and it is
 * the silent one: a mistyped output is not an error, it is the empty string, so
 * `if: needs.changes.outputs.webb == 'true'` skips the layer on every run
 * forever and reports a tidy green tick. The same is true of a job that reads
 * `needs.changes.*` without declaring `needs: changes`.
 *
 * These assertions are about wiring the YAML cannot check itself. What each
 * gate should decide is tested in ci-surfaces.test.ts.
 */

interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
}

const workflow = Bun.YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8")) as {
  jobs: Record<string, Job>;
};

const GATE = "changes";
const reference = /needs\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)/g;

const referencesIn = (job: Job) => [...(job.if ?? "").matchAll(reference)];
const needsOf = (job: Job) => (typeof job.needs === "string" ? [job.needs] : (job.needs ?? []));

describe("ci.yml gating", () => {
  test("every gated job reads an output the gate actually declares", () => {
    const declared = new Set(Object.keys(workflow.jobs[GATE]?.outputs ?? {}));
    const unknown = Object.entries(workflow.jobs).flatMap(([id, job]) =>
      referencesIn(job)
        .filter(([, source, output]) => source === GATE && !declared.has(output!))
        .map(([, , output]) => `${id}: needs.${GATE}.outputs.${output}`),
    );

    expect(unknown).toEqual([]);
  });

  test("every job that reads another job's outputs declares it in needs", () => {
    const undeclared = Object.entries(workflow.jobs).flatMap(([id, job]) =>
      referencesIn(job)
        .filter(([, source]) => !needsOf(job).includes(source!))
        .map(([, source]) => `${id}: reads ${source} without needing it`),
    );

    expect(undeclared).toEqual([]);
  });

  test("the gate's surface outputs are exactly the ones the script decides", () => {
    const declared = Object.keys(workflow.jobs[GATE]?.outputs ?? {});
    // `proven` is the duplicate-run check, decided elsewhere; the rest are the
    // layers, and they have to line up with the script one for one.
    const surfaces = declared.filter((output) => output !== "proven").sort();

    expect(surfaces).toEqual(Object.keys(surfacesFor([])).sort());
  });

  /**
   * A step that pipes into $GITHUB_OUTPUT hands its exit status to `tee`, which
   * succeeds whatever happened upstream. The gate then reports success with
   * every output empty, and every job gated on one of those outputs skips — a
   * green run that tested a third of what it claims. The failure is silent in
   * the direction that matters, so the shell has to be told to fail closed.
   */
  test("every gate pipeline fails closed", () => {
    const steps = (workflow.jobs[GATE]?.steps ?? []) as { name?: string; run?: string }[];

    const unguarded = steps
      .filter((step) => step.run?.includes("$GITHUB_OUTPUT") && step.run.includes("|"))
      .filter((step) => !step.run?.includes("set -o pipefail"))
      .map((step) => step.name ?? "(unnamed)");

    expect(unguarded).toEqual([]);
  });
});
