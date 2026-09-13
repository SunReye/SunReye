import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Does a release actually reach the appliance image?
 *
 * GitHub suppresses workflow runs for events made by `GITHUB_TOKEN`. The repo
 * already works around that once — release-please dispatches the Docker builds
 * explicitly, because the tags it pushes cannot trigger `on: push: tags`. The
 * same rule applies one link further down, and that link was missed: the
 * appliance publish waited on `workflow_run: ["Docker · server"]`, and that
 * server build is itself a token dispatch, so its completion emits no event.
 *
 * 3.2.0 shipped both container images and no appliance image because of it, and
 * nothing failed — there was simply no run. A chain that cannot fire is
 * indistinguishable from one that has not fired yet, which is why this is a test
 * and not a comment.
 */
const workflow = (name: string) => readFileSync(`.github/workflows/${name}`, "utf8");

/** A step's executable lines: what the runner actually does, without the prose. */
const executable = (yaml: string) =>
  yaml
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

describe("the appliance release chain", () => {
  const appliance = workflow("nixos-image.yml");
  const server = workflow("docker-server.yml");

  test("publishing does not wait on a token-dispatched workflow_run", () => {
    // Parsed, not sliced. The first version of this searched for a job called
    // `publish:`, which was renamed to `pin` in the very commit it shipped with:
    // indexOf returned -1, slice(-1) handed it the file's last character, and
    // the assertion passed on a one-character string. A gate that reads source
    // text by name is one rename from asserting nothing at all — which is the
    // failure class this whole file exists to catch.
    const parsed = Bun.YAML.parse(appliance) as {
      on?: Record<string, unknown>;
      jobs: Record<string, { if?: string }>;
    };

    // The trigger itself must not be a workflow_run …
    const triggers = Object.keys(parsed.on ?? (parsed as Record<string, never>)[true] ?? {});
    expect(triggers).not.toContain("workflow_run");

    // … and no job may gate on one either.
    const gatedOnRun = Object.entries(parsed.jobs)
      .filter(([, job]) => job.if?.includes("workflow_run"))
      .map(([id]) => id);
    expect(gatedOnRun).toEqual([]);
  });

  test("the server build hands off to it", () => {
    // The handoff has to be an explicit dispatch, which a token MAY make.
    expect(server).toMatch(/gh workflow run nixos-image\.yml/);
    // …and dispatching needs the permission, which is not granted by default.
    expect(server).toMatch(/actions: write/);
  });

  test("the handoff passes an input the appliance declares", () => {
    const passed = /-f\s+([a-z_]+)=/.exec(server)?.[1];
    expect(passed).toBeDefined();

    const inputs = appliance.slice(
      appliance.indexOf("workflow_dispatch:"),
      appliance.indexOf("permissions:"),
    );
    expect(inputs).toContain(`${passed}:`);
  });

  /**
   * A box in the field never needs the flashable image: it owns /etc/nixos,
   * follows `stable`, and rebuilds nightly. What it needs is the repin and the
   * `stable` fast-forward — and those used to be the first and last steps of the
   * same job that spent ~20 minutes building a 1.6 GB artifact. Skipping the
   * artifact therefore meant deployed boxes silently never saw the release.
   */
  test("advertising a release does not depend on building an image", () => {
    const parsed = Bun.YAML.parse(appliance) as {
      jobs: Record<string, { if?: string; steps?: { name?: string; run?: string }[] }>;
    };

    const advancing = Object.entries(parsed.jobs).find(([, job]) =>
      job.steps?.some((step) => step.run?.includes("HEAD:stable")),
    );
    expect(advancing).toBeDefined();

    const [, job] = advancing!;
    const buildsImage = job.steps?.some((step) => step.run?.includes("nixos#image"));
    expect(buildsImage).toBeFalsy();
  });

  test("the image build is opt-in, so it cannot gate updates", () => {
    const parsed = Bun.YAML.parse(appliance) as {
      jobs: Record<string, { if?: string; steps?: { run?: string }[] }>;
    };

    const [, imageJob] =
      Object.entries(parsed.jobs).find(([, job]) =>
        job.steps?.some((step) => step.run?.includes("nixos#image")),
      ) ?? [];
    expect(imageJob?.if).toContain("inputs.image");
  });

  /**
   * The repin step reads a hash out of another program's output, and it read it
   * out of the stream it had just thrown away: `-> ImageHash:` is printed on
   * STDERR by nix-prefetch-docker, while stdout carries the Nix attrset. With
   * `2>/dev/null` on the pipeline, the grep matched nothing, the hash came out
   * empty, `test -n` failed, and the discarded stream took the explanation with
   * it. The step had never run — it was written from the documented output and
   * gated behind a trigger that could not fire.
   */
  test("the repin parses a stream it has not discarded", () => {
    // Comments stripped, so the assertion is about what the runner executes.
    // Explaining WHY the old version was wrong has to stay allowed — that prose
    // is the only thing standing between the next author and rewriting it.
    const step = executable(
      appliance.slice(
        appliance.indexOf("- name: Repin the server image"),
        appliance.indexOf("- name: Commit to master"),
      ),
    );

    // Nothing it parses may be sent to /dev/null.
    expect(step).not.toContain("2>/dev/null");
    // And it reads the machine-readable attrset on stdout, not the log line.
    expect(step).not.toContain("-> ImageHash:");
    expect(step).toMatch(/hash = /);
  });

  test("the repin fails loudly when a command in its pipeline does", () => {
    const step = appliance.slice(
      appliance.indexOf("- name: Repin the server image"),
      appliance.indexOf("- name: Commit to master"),
    );

    // Without pipefail a failed skopeo still yields a plausible-looking digest,
    // because the exit status belongs to `cut`.
    expect(step).toContain("set -o pipefail");
  });
});
