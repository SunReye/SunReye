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

interface Step {
  id?: string;
  run?: string;
}

interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
  steps?: Step[];
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

  /*
   * Asserting that the gate DECLARES `web` says nothing about what `web` is
   * worth. `web: ${{ steps.surfaces.outputs.wev }}` declares it perfectly and
   * evaluates to the empty string on every run, so every gated job skips
   * forever and the workflow is green — the same silent direction the tests
   * above are here to close, one level further in.
   */
  test("each surface output is wired to a step output of the same name", () => {
    const gate = workflow.jobs[GATE]!;
    const ids = new Set((gate.steps ?? []).flatMap((step) => (step.id ? [step.id] : [])));

    const broken = Object.entries(gate.outputs ?? {}).flatMap(([name, expression]) => {
      const wiring = expression.match(/steps\.([\w-]+)\.outputs\.([\w-]+)/);
      if (!wiring) return [`${name}: reads no step output at all — ${expression}`];

      const [, step, output] = wiring;
      if (!ids.has(step!))
        return [`${name}: reads step '${step}', which this job has no step with`];
      if (output !== name) return [`${name}: reads steps.${step}.outputs.${output}`];
      return [];
    });

    expect(broken).toEqual([]);
  });

  // And the step it reads has to be the one that decides them: the script
  // prints `name=bool` lines, and only a `tee` into $GITHUB_OUTPUT makes them
  // outputs. A run that merely prints them leaves every output empty.
  test("the deciding step writes the script's own lines to GITHUB_OUTPUT", () => {
    const gate = workflow.jobs[GATE]!;
    const step = (gate.steps ?? []).find((s) => s.id === "surfaces");

    expect(step?.run).toContain("ci-surfaces.ts");
    expect(step?.run).toMatch(/tee -a "\$GITHUB_OUTPUT"/);
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
