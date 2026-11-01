import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `scripts/target-gate` builds the workspace for Android (ADR 0006). Stand-in `cargo`, `rustup` and
 * `cargo-ndk` record what they were asked, so what is proven is the script's own contract: the exact
 * build command, that a missing toolchain fails naming `scripts/setup-targets` before any build runs,
 * and that a failing build fails the gate.
 */

let dir: string;
let bin: string;
let home: string;

async function stub(name: string, body: string) {
  const path = join(bin, name);
  await writeFile(path, `#!/usr/bin/env bash\n${body}\n`);
  await chmod(path, 0o755);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "target-gate-"));
  bin = join(dir, "bin");
  home = join(dir, "targets");
  await mkdir(bin);
  await stub(
    "cargo",
    'echo "$*" >> "$CARGO_LOG"\n[[ "$*" == *"${FAIL_ON:-@@}"* ]] && exit 7\nexit 0',
  );
  await stub(
    "rustup",
    'case "$*" in\n' +
      '  "target list --installed") echo "x86_64-unknown-linux-gnu"; [[ " $MISSING " == *" android-target "* ]] || echo "aarch64-linux-android" ;;\n' +
      "esac",
  );
  await stub("cargo-ndk", "exit 0");
  await mkdir(join(home, "android-ndk-r27c"), { recursive: true });
});

afterEach(() => rm(dir, { recursive: true, force: true }));

/** Remove one toolchain piece from the sandbox; `rustup` pieces are hidden through `MISSING`. */
async function without(piece: string) {
  if (piece === "cargo-ndk") await rm(join(bin, piece));
  else if (piece === "ndk") await rm(join(home, "android-ndk-r27c"), { recursive: true });
}

async function gate(env: { missing?: string; failOn?: string; ndkHome?: string } = {}) {
  const log = join(dir, "log");
  const proc = Bun.spawn(["scripts/target-gate"], {
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: join(dir, "home"),
      SUNREYE_TARGETS_HOME: home,
      CARGO_LOG: log,
      MISSING: env.missing ?? "",
      FAIL_ON: env.failOn ?? "",
      ...(env.ndkHome ? { ANDROID_NDK_HOME: env.ndkHome } : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  const stdout = await new Response(proc.stdout).text();
  const calls = await readFile(log, "utf8").then(
    (text) => text.trim().split("\n"),
    () => [],
  );
  return { code, calls, stderr, stdout };
}

describe("scripts/target-gate", () => {
  test("builds the workspace for Android and nothing else", async () => {
    const { code, calls } = await gate();
    expect(code).toBe(0);
    expect(calls).toEqual(["ndk -t arm64-v8a build --workspace"]);
  });

  test("reports how long the Android build took", async () => {
    const { stdout } = await gate();
    expect(stdout).toMatch(/aarch64-linux-android: built in \d+s/);
  });

  test("an Android build failure fails the gate", async () => {
    const { code } = await gate({ failOn: "ndk" });
    expect(code).not.toBe(0);
  });

  test("an ANDROID_NDK_HOME that exists replaces the installed NDK", async () => {
    await without("ndk");
    const own = join(dir, "own-ndk");
    await mkdir(own);
    const { code } = await gate({ ndkHome: own });
    expect(code).toBe(0);
  });

  describe("a missing toolchain piece", () => {
    for (const piece of ["cargo-ndk", "ndk", "android-target"] as const) {
      test(`${piece}: names scripts/setup-targets and builds nothing`, async () => {
        await without(piece);
        const { code, calls, stderr } = await gate({ missing: piece });
        expect(code).not.toBe(0);
        expect(stderr).toContain("scripts/setup-targets");
        expect(stderr).toContain(piece);
        expect(calls).toEqual([]);
      });
    }

    test("every missing piece is listed, not only the first", async () => {
      await without("cargo-ndk");
      await without("ndk");
      const { stderr } = await gate();
      expect(stderr).toContain("cargo-ndk");
      expect(stderr).toContain("ndk");
    });
  });
});
