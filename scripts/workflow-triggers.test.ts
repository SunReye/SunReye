import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

/**
 * A trigger that can never fire.
 *
 * GitHub suppresses workflow runs for events made by `GITHUB_TOKEN`, and every
 * release tag in this repo is pushed by release-please with that token. So
 * `on: push: tags` is not a weak gate, it is no gate: `db-restore.yml` and
 * `upgrade-test.yml` both carried one under a comment reading "a red restore
 * blocks the release", and across the last twenty runs of each, every single
 * one was a `pull_request` — not one `push`. The releases they claimed to gate
 * went out ungated by them, and nothing ever went red, because nothing ever ran.
 *
 * The release IS gated, by the release PR: release-please opens one, and these
 * workflows run on it. That is the honest version of the same guarantee. This
 * test keeps the dead spelling from coming back under a comment that says
 * otherwise.
 */
const DIR = `${import.meta.dir}/../.github/workflows`;

const workflows = readdirSync(DIR)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => {
    // `on` is a YAML 1.1 boolean, so a parser may hand it back under the key
    // `true`. Reading only `.on` would find nothing and pass every sweep below.
    const doc = Bun.YAML.parse(readFileSync(`${DIR}/${name}`, "utf8")) as Record<string, unknown>;
    return { name, on: (doc.on ?? doc[String(true)]) as Record<string, unknown> | undefined };
  });

describe("workflow triggers", () => {
  test("there is more than one workflow to check", () => {
    // Guards the sweep itself: a glob that matches nothing passes every
    // assertion below without reading a single file.
    expect(workflows.length).toBeGreaterThan(5);
  });

  test("nothing waits on a tag push, which a token-pushed tag never emits", () => {
    const dead = workflows
      .filter((w) => {
        const push = w.on?.push;
        return typeof push === "object" && push !== null && "tags" in push;
      })
      .map((w) => w.name);

    expect(dead).toEqual([]);
  });
});
