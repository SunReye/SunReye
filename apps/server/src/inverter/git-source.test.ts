import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineProfile, metric } from "@SunReye/inverter-core";

import { readIndex, readProfile, syncRepo } from "./git-source";

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

async function commitAll(dir: string, message: string) {
  const opts = { cwd: dir } as const;
  await Bun.spawn(["git", "add", "-A"], opts).exited;
  await Bun.spawn(["git", "commit", "-m", message], {
    ...opts,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  }).exited;
}

beforeAll(async () => {
  originDir = await mkdtemp(join(tmpdir(), "sunreye-origin-"));
  await Bun.spawn(["git", "init", "-b", "main"], { cwd: originDir }).exited;
  await mkdir(join(originDir, "profiles"), { recursive: true });
  await writeFile(join(originDir, "index.json"), indexJson("1.0.0"));
  await writeFile(join(originDir, "profiles", "acme-test.json"), profileJson);
  await commitAll(originDir, "initial");
  originUrl = `file://${originDir}`;
});

afterAll(async () => {
  await rm(originDir, { recursive: true, force: true });
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
