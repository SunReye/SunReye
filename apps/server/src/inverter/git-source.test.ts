import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

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

  test("re-clones when the cached clone is too broken to update", async () => {
    // A clone killed mid-write across a container restart leaves a tree that
    // still has .git/HEAD but that git refuses to work in. Wiping and cloning
    // again is what stops a source being wedged until someone clears /tmp.
    const dir = await syncRepo(originUrl);
    await writeFile(join(dir, ".git", "config"), "this is not a git config\n");

    const again = await syncRepo(originUrl);

    expect(again).toBe(dir);
    expect((await readIndex(again)).profiles[0]?.id).toBe("acme-test");
  });

  test("a source that isn't a repository yet fails, and works once it exists", async () => {
    // The URL is saved before the repo is published (a typo'd org, a repo made
    // public later). The first browse must fail loudly and the retry must still
    // be able to clone — the failure may not leave the cache entry poisoned.
    const late = await mkdtemp(join(tmpdir(), "sunreye-late-"));
    const lateUrl = `file://${late}`;

    await expect(syncRepo(lateUrl)).rejects.toThrow(/git clone failed/);

    await Bun.spawn(["git", "init", "-b", "main"], { cwd: late, env: gitEnv() }).exited;
    await mkdir(join(late, "profiles"), { recursive: true });
    await writeFile(join(late, "index.json"), indexJson("1.0.0"));
    await writeFile(join(late, "profiles", "acme-test.json"), profileJson);
    await commitAll(late, "published");

    const dir = await syncRepo(lateUrl);
    expect((await readIndex(dir)).profiles[0]?.version).toBe("1.0.0");

    await rm(late, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  });

  test("every overlapping sync of a broken source reports the git failure", async () => {
    // Serialization must not turn one caller's failure into the others' — each
    // browse of a broken source gets the real error, not a poisoned chain.
    const broken = await mkdtemp(join(tmpdir(), "sunreye-broken-"));
    const brokenUrl = `file://${broken}`;

    const results = await Promise.allSettled([
      syncRepo(brokenUrl),
      syncRepo(brokenUrl),
      syncRepo(brokenUrl),
    ]);

    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    for (const r of results) {
      expect(String((r as PromiseRejectedResult).reason)).toMatch(/git clone failed/);
    }
    await rm(broken, { recursive: true, force: true });
  });

  test("rejects an absolute path, not just a relative one that climbs out", async () => {
    const dir = await syncRepo(originUrl);
    await expect(readProfile(dir, "/etc/passwd")).rejects.toThrow(/escapes repository/);
  });

  test("rejects a sibling directory whose name merely starts with the clone's", async () => {
    // `/tmp/cache/abc123-evil` starts with `/tmp/cache/abc123`; only the
    // separator in the prefix check keeps it out.
    const dir = await syncRepo(originUrl);
    await expect(
      readProfile(dir, `../${basename(dir)}-evil/profiles/acme-test.json`),
    ).rejects.toThrow(/escapes repository/);
  });

  test("reports a profile the index lists but the repo does not contain", async () => {
    const dir = await syncRepo(originUrl);
    await expect(readProfile(dir, "profiles/missing.json")).rejects.toThrow(
      /file not found in repo/,
    );
  });

  test("refuses to parse a file far larger than any profile", async () => {
    // A source can commit anything; the parser must not be handed a gigabyte.
    const dir = await syncRepo(originUrl);
    const huge = join(dir, "huge.json");
    await writeFile(huge, "x".repeat(1_000_001));

    await expect(readProfile(dir, "huge.json")).rejects.toThrow(/file too large/);

    await rm(huge, { force: true });
  });

  test("rejects an index.json that is not a repo manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sunreye-badindex-"));
    await writeFile(join(dir, "index.json"), JSON.stringify({ name: "Test Repo" }));

    await expect(readIndex(dir)).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });
});
