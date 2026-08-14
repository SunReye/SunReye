import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineProfile, metric } from "@SunReye/inverter-core";

import { cleanGitEnv, readIndex, readProfile, syncRepo } from "./git-source";

/** A valid profile file, authored with the SDK, committed to the fake repo. */
const profileJson = JSON.stringify(
  defineProfile({
    id: "acme-test",
    name: "ACME Test",
    manufacturer: "ACME",
    version: "1.0.0",
    metrics: [
      metric("battery/soc", {
        label: "SOC",
        unit: "%",
        group: "battery",
        addr: 100,
        role: "battery.soc",
      }),
    ],
  }),
);

const indexJson = (version: string) =>
  JSON.stringify({
    name: "Test Repo",
    maintainer: "tester",
    profiles: [
      {
        id: "acme-test",
        name: "ACME Test",
        manufacturer: "ACME",
        version,
        path: "profiles/acme-test.json",
      },
    ],
  });

let originDir: string;
let originUrl: string;

/**
 * The fixture's git env: no ambient plumbing, a fixed identity. Inherited from a
 * git hook, GIT_DIR & co. point the fixture's own `git init`/`add`/`commit` at
 * the repository running the hook — it then commits its temp tree onto the
 * developer's branch while the clone under test fails. Same reason production
 * strips them; same helper.
 */
const gitEnv = () => ({
  ...cleanGitEnv(process.env),
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
});

async function commitAll(dir: string, message: string) {
  const opts = { cwd: dir, env: gitEnv() } as const;
  await Bun.spawn(["git", "add", "-A"], opts).exited;
  await Bun.spawn(["git", "commit", "-m", message], opts).exited;
}

beforeAll(async () => {
  originDir = await mkdtemp(join(tmpdir(), "sunreye-origin-"));
  await Bun.spawn(["git", "init", "-b", "main"], { cwd: originDir, env: gitEnv() }).exited;
  await mkdir(join(originDir, "profiles"), { recursive: true });
  await writeFile(join(originDir, "index.json"), indexJson("1.0.0"));
  await writeFile(join(originDir, "profiles", "acme-test.json"), profileJson);
  await commitAll(originDir, "initial");
  originUrl = `file://${originDir}`;
});

afterAll(async () => {
  await rm(originDir, { recursive: true, force: true });
});

describe("cleanGitEnv", () => {
  // Regression: run from a git hook, the fixture below inherited GIT_DIR and
  // committed its temp tree onto the branch being committed — while the clone
  // under test failed with "does not appear to be a git repository".
  test("drops the plumbing variables a git hook exports", () => {
    const cleaned = cleanGitEnv({
      GIT_DIR: "/repo/.git",
      GIT_WORK_TREE: "/repo",
      GIT_INDEX_FILE: "/repo/.git/index",
      GIT_PREFIX: "",
      GIT_COMMON_DIR: "/repo/.git",
      GIT_OBJECT_DIRECTORY: "/repo/.git/objects",
      GIT_NAMESPACE: "ns",
    });
    expect(cleaned).toEqual({});
  });

  test("keeps everything else, including the identity git needs to commit", () => {
    expect(cleanGitEnv({ PATH: "/usr/bin", GIT_AUTHOR_NAME: "t", GIT_DIR: "/repo/.git" })).toEqual({
      PATH: "/usr/bin",
      GIT_AUTHOR_NAME: "t",
    });
  });

  test("drops unset variables rather than passing undefined through", () => {
    expect(cleanGitEnv({ HOME: undefined, PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });
});

describe("git-source", () => {
  test("clones a repo and reads + validates its index", async () => {
    const dir = await syncRepo(originUrl);
    const index = await readIndex(dir);
    expect(index.profiles).toHaveLength(1);
    expect(index.profiles[0]?.id).toBe("acme-test");
  });

  test("reads + strictly validates a listed profile", async () => {
    const dir = await syncRepo(originUrl);
    const data = await readProfile(dir, "profiles/acme-test.json");
    expect(data.id).toBe("acme-test");
    expect(data.metrics).toHaveLength(1);
  });

  test("git pull picks up an updated version", async () => {
    await writeFile(join(originDir, "index.json"), indexJson("2.0.0"));
    await commitAll(originDir, "bump");
    const dir = await syncRepo(originUrl); // existing clone → fetch + reset
    const index = await readIndex(dir);
    expect(index.profiles[0]?.version).toBe("2.0.0");
  });

  test("rejects a path escaping the repo", async () => {
    const dir = await syncRepo(originUrl);
    await expect(readProfile(dir, "../../../etc/passwd")).rejects.toThrow(/escapes repository/);
  });

  test("rejects a non-https, non-file URL", async () => {
    await expect(syncRepo("ssh://git@example.com/x.git")).rejects.toThrow(/only https/);
  });

  test("serializes concurrent syncs of the same URL (no lock race)", async () => {
    // Two git processes in the same clone dir race on .git/*.lock. Fire a burst
    // of overlapping syncs; serialization must let them all succeed on the same
    // dir rather than one blowing up with "Another git process seems to be
    // running".
    const dirs = await Promise.all(Array.from({ length: 5 }, () => syncRepo(originUrl)));
    expect(new Set(dirs).size).toBe(1);
    const index = await readIndex(dirs[0] as string);
    expect(index.profiles[0]?.id).toBe("acme-test");
  });
});
