import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Every release publishes by committing to `master` from a job that checked
 * master out minutes earlier. The addon publish, the appliance pin and the beta
 * all do it, and a release fires the first two at once — so whichever pushes
 * second finds master moved. The appliance pin lost that race on 3.4.0 (run
 * 34960887231, attempt 1: `! [rejected] HEAD -> master (fetch first)`), and a
 * lost pin skips `Advance stable`: every deployed box stays on the old version
 * while the release reads as shipped.
 *
 * These run each step's own script against a throwaway remote that has moved
 * since the checkout, which is the condition a release produces.
 */
const DIR = `${import.meta.dir}/../.github/workflows`;

interface Step {
  name?: string;
  run?: string;
}

const steps = readdirSync(DIR)
  .filter((file) => file.endsWith(".yml"))
  .flatMap((file) => {
    const doc = Bun.YAML.parse(readFileSync(join(DIR, file), "utf8")) as {
      jobs: Record<string, { steps?: Step[] }>;
    };
    return Object.values(doc.jobs).flatMap((job) =>
      (job.steps ?? []).map((step) => ({ file, step })),
    );
  });

const pushesTo = (branch: string) =>
  steps.filter(({ step }) => step.run?.includes(`HEAD:${branch}`));

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// A hook exports GIT_DIR & co.; a spawned git would then act on this repository.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

function sh(cwd: string, script: string) {
  const result = Bun.spawnSync(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
    cwd,
    env: { ...env, GITHUB_REF_NAME: "addon-v9.9.9" },
  });
  return { code: result.exitCode, out: `${result.stdout}${result.stderr}` };
}

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, env });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.toString().trim();
}

/** The files a step stages: a path with no extension is a generated directory. */
function stagedFiles(script: string) {
  const paths = /git add (.+)/.exec(script)?.[1]?.trim().split(/\s+/) ?? [];
  return paths.map((path) => (/\.[a-z]+$/.test(path) ? path : join(path, "generated")));
}

function write(root: string, path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/**
 * A remote whose master already holds `files`, and a clone of it standing in for
 * the job's checkout.
 */
function remoteAndCheckout(files: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), "publish-to-master-"));
  roots.push(root);
  const remote = join(root, "remote.git");
  git(root, "init", "--quiet", "--bare", "--initial-branch=master", remote);

  const seed = join(root, "seed");
  git(root, "clone", "--quiet", remote, seed);
  git(seed, "config", "user.name", "test");
  git(seed, "config", "user.email", "test@example.invalid");
  for (const path of ["README", ...files]) write(seed, path, "seed\n");
  git(seed, "add", "--all");
  git(seed, "commit", "--quiet", "-m", "seed");
  git(seed, "push", "--quiet", "origin", "HEAD:master");

  // Shallow, as actions/checkout leaves it by default.
  const job = join(root, "job");
  git(root, "clone", "--quiet", "--depth=1", `file://${remote}`, job);
  return { remote, seed, job };
}

/** Another publish lands first, touching a file this step does not. */
function masterMoves(seed: string) {
  writeFileSync(join(seed, "OTHER"), "another publish\n");
  git(seed, "add", "OTHER");
  git(seed, "commit", "--quiet", "-m", "chore: another publish");
  git(seed, "push", "--quiet", "origin", "HEAD:master");
}

/** The step's shell with every `${{ … }}` expression resolved to a plausible value. */
const runnable = (script: string) => script.replaceAll(/\$\{\{[^}]*\}\}/g, "9.9.9");

describe("publishing to master", () => {
  test("every release publish is found", () => {
    // Guards the sweep: renaming a step or a file must not leave these
    // tests passing over nothing.
    expect(
      pushesTo("master")
        .map(({ file }) => file)
        .sort(),
    ).toEqual(["docker-addon-beta.yml", "docker-addon.yml", "nixos-image.yml"]);
  });

  for (const { file, step } of pushesTo("master")) {
    test(`${file} "${step.name}" lands when master moved after its checkout`, () => {
      const files = stagedFiles(step.run!);
      expect(files.length).toBeGreaterThan(0);
      const { remote, seed, job } = remoteAndCheckout(files);
      // The steps before this one: what it commits has changed.
      for (const path of files) write(job, path, "published\n");
      masterMoves(seed);

      const { code, out } = sh(job, runnable(step.run!));

      expect({ code, out }).toEqual({ code: 0, out: expect.any(String) });
      const log = git(remote, "log", "--format=%s", "master");
      expect(log).toContain("chore: another publish");
      expect(log.split("\n")[0]).toContain("publish 9.9.9");
    });
  }
});

describe("advancing stable", () => {
  const [advance] = pushesTo("stable");

  test("there is a step that advances it", () => {
    expect(advance).toBeDefined();
  });

  test("never moves it to a commit that does not contain it", () => {
    // `stable` is what every box upgrades to unattended. A pin that started
    // earlier but finished later must not drag it back to an older release.
    const { remote, seed, job } = remoteAndCheckout();
    masterMoves(seed);
    git(seed, "push", "--quiet", "origin", "HEAD:stable");
    const stableBefore = git(remote, "rev-parse", "stable");

    const { code } = sh(job, runnable(advance!.step.run!));

    expect(code).not.toBe(0);
    expect(git(remote, "rev-parse", "stable")).toBe(stableBefore);
  });

  test("fast-forwards to the commit the pin published", () => {
    const { remote, seed, job } = remoteAndCheckout();
    git(seed, "push", "--quiet", "origin", "HEAD:stable");
    masterMoves(seed);
    git(job, "pull", "--quiet", "origin", "master");

    const { code, out } = sh(job, runnable(advance!.step.run!));

    expect({ code, out }).toEqual({ code: 0, out: expect.any(String) });
    expect(git(remote, "rev-parse", "stable")).toBe(git(remote, "rev-parse", "master"));
  });
});
