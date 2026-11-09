import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git.ts";
import { planRelease } from "./release-plan.ts";

/** A checkout whose manifests name `version`, with one commit per subject. */
async function checkout(version: string, subjects: readonly string[]): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "release-"));

  await mkdir(join(repo, "packaging/addon"), { recursive: true });
  await writeFile(
    join(repo, "Cargo.toml"),
    `[workspace]\nmembers = []\n\n[workspace.package]\nversion = "${version}"\n`,
  );
  await writeFile(
    join(repo, "packaging/addon/config.yaml"),
    `name: SunReye 5\nversion: ${version}\nslug: sunreye_v5\n`,
  );
  git(repo, ["init", "-q", "-b", "master"]);
  git(repo, ["add", "-A"]);
  commit(repo, "chore: start");

  for (const subject of subjects) commit(repo, subject);

  return repo;
}

function commit(repo: string, message: string): void {
  git(repo, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "--date=2026-11-09T12:00:00Z",
    "-m",
    message,
  ]);
}

/** Sets the version both manifests name and commits it. */
async function bump(repo: string, version: string): Promise<void> {
  await writeFile(
    join(repo, "Cargo.toml"),
    `[workspace]\nmembers = []\n\n[workspace.package]\nversion = "${version}"\n`,
  );
  await writeFile(
    join(repo, "packaging/addon/config.yaml"),
    `name: SunReye 5\nversion: ${version}\nslug: sunreye_v5\n`,
  );
  git(repo, ["add", "-A"]);
  commit(repo, `chore(release): ${version}`);
}

async function refusal(repo: string): Promise<string> {
  try {
    await planRelease(repo);

    return "";
  } catch (error) {
    return String(error);
  }
}

test("the first release takes its version from the manifests", async () => {
  const repo = await checkout("5.0.0", ["feat(core): poll inverters"]);

  expect(await planRelease(repo)).toMatchObject({ version: "5.0.0", tag: "v5.0.0" });
});

test("the changelog lists breaking changes, features, fixes and performance from conventional commits", async () => {
  const repo = await checkout("5.0.0", [
    "feat(core): poll inverters",
    "docs(adr): record storage",
    "fix: round energy to the watt-hour",
    "perf(api): serve live values from memory",
    "feat(api)!: drop the v1 routes",
    "refactor(core): rename the poller\n\nBREAKING CHANGE: the poll interval moved",
    "Merge-like subject without a type",
  ]);

  const { notes } = await planRelease(repo);

  expect(notes).toBe(
    [
      "## 5.0.0 (2026-11-09)",
      "",
      "### Breaking changes",
      "",
      "- **core:** rename the poller",
      "- **api:** drop the v1 routes",
      "",
      "### Features",
      "",
      "- **api:** drop the v1 routes",
      "- **core:** poll inverters",
      "",
      "### Fixes",
      "",
      "- round energy to the watt-hour",
      "",
      "### Performance",
      "",
      "- **api:** serve live values from memory",
      "",
    ].join("\n"),
  );
});

/** A checkout released as v5.0.0, then given `subjects`. */
async function released(subjects: readonly string[]): Promise<string> {
  const repo = await checkout("5.0.0", ["feat(core): poll inverters"]);

  git(repo, ["tag", "v5.0.0"]);

  for (const subject of subjects) commit(repo, subject);

  return repo;
}

test("the changelog covers only the commits since the last release", async () => {
  const repo = await released(["fix: keep the last good profile"]);

  await bump(repo, "5.0.1");

  expect(await planRelease(repo)).toEqual({
    version: "5.0.1",
    tag: "v5.0.1",
    notes: "## 5.0.1 (2026-11-09)\n\n### Fixes\n\n- keep the last good profile\n",
  });
});

test.each([
  ["fix: a", "5.0.1"],
  ["perf: a", "5.0.1"],
  ["feat: a", "5.1.0"],
  ["fix!: a", "6.0.0"],
])("after %p the manifests must name at least %p", async (subject, least) => {
  const repo = await released([subject]);

  expect(await refusal(repo)).toBe(
    `Error: the commits since v5.0.0 need version ${least} or above; Cargo.toml names 5.0.0`,
  );
});

test("a version raised above what the commits need is kept", async () => {
  const repo = await released(["fix: a"]);

  await bump(repo, "6.0.0");

  expect(await planRelease(repo)).toMatchObject({ version: "6.0.0" });
});

test("nothing but chores since the last release is refused", async () => {
  const repo = await released(["docs: a", "chore: b"]);

  expect(await refusal(repo)).toBe(
    "Error: nothing to release: no feature, fix or performance commit since v5.0.0",
  );
});

test("an add-on manifest naming another version is refused", async () => {
  const repo = await checkout("5.0.0", ["feat: a"]);

  await writeFile(join(repo, "packaging/addon/config.yaml"), "version: 5.0.1\n");
  git(repo, ["add", "-A"]);
  commit(repo, "chore: x");

  expect(await refusal(repo)).toBe(
    "Error: packaging/addon/config.yaml names version 5.0.1; Cargo.toml names 5.0.0",
  );
});

test("a checkout with uncommitted changes is refused", async () => {
  const repo = await checkout("5.0.0", ["feat: a"]);

  await writeFile(join(repo, "stray"), "");

  expect(await refusal(repo)).toBe(
    "Error: the checkout has uncommitted changes: commit them first",
  );
});
