import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `scripts/setup-targets` installs what `scripts/target-gate` checks for. Stand-in installers record
 * their arguments: what is proven is which command runs for which missing piece, and that a machine
 * that has everything installs nothing.
 */

let dir: string;
let bin: string;
let home: string;

async function stub(name: string, body: string) {
  const path = join(bin, name);
  await writeFile(path, `#!/usr/bin/env bash\n${body}\n`);
  await chmod(path, 0o755);
}

const record = 'echo "$(basename "$0") $*" >> "$LOG"';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "setup-targets-"));
  bin = join(dir, "bin");
  home = join(dir, "targets");
  await mkdir(bin);
  await stub(
    "rustup",
    `${record}\n` +
      'case "$*" in\n' +
      '  "target list --installed") [[ $PRESENT == all ]] && echo "aarch64-linux-android" ;;\n' +
      "esac\nexit 0",
  );
  for (const name of ["cargo", "curl"]) await stub(name, `${record}`);
  // unzip creates what the real archive holds, so the NDK check can see it.
  await stub("unzip", `${record}\nmkdir -p "$4/android-ndk-r27c"`);
});

afterEach(() => rm(dir, { recursive: true, force: true }));

async function setup(present: "all" | "none") {
  if (present === "all") {
    await stub("cargo-ndk", "exit 0");
    await stub("cargo-sqlx", "exit 0");
    await mkdir(join(home, "android-ndk-r27c"), { recursive: true });
  }
  const log = join(dir, "log");
  await writeFile(log, "");
  const proc = Bun.spawn(["scripts/setup-targets"], {
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: join(dir, "home"),
      SUNREYE_TARGETS_HOME: home,
      LOG: log,
      PRESENT: present,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const calls = (await readFile(log, "utf8")).split("\n").filter(Boolean);
  return { code, calls, stderr: await new Response(proc.stderr).text() };
}

describe("scripts/setup-targets", () => {
  test("installs every missing piece", async () => {
    const { code, calls } = await setup("none");
    expect(code).toBe(0);
    expect(calls).toContain("rustup target add aarch64-linux-android");
    expect(calls).toContain("cargo install cargo-ndk --locked");
    expect(calls).toContain(
      "cargo install sqlx-cli --locked --no-default-features --features sqlite",
    );
    expect(
      calls.some((c) => c.startsWith("curl") && c.includes("android-ndk-r27c-linux.zip")),
    ).toBe(true);
  });

  test("a machine that has everything installs nothing", async () => {
    const { code, calls } = await setup("all");
    expect(code).toBe(0);
    expect(calls.filter((c) => /^(rustup target add|cargo install|curl|unzip)/.test(c))).toEqual(
      [],
    );
  });
});
