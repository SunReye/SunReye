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
});
