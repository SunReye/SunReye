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

describe("the appliance release chain", () => {
  const appliance = workflow("nixos-image.yml");
  const server = workflow("docker-server.yml");

  test("publishing does not wait on a token-dispatched workflow_run", () => {
    const publishBlock = appliance.slice(appliance.indexOf("  publish:"));
    const condition = publishBlock.slice(0, publishBlock.indexOf("runs-on"));

    expect(condition).not.toContain("workflow_run");
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
});
