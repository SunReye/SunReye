import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `scripts/target-gate` builds the workspace for Android and ESP-IDF (ADR 0006). Stand-in `cargo`,
 * `rustup` and friends record what they were asked, so what is proven is the script's own contract:
 * the exact build commands, that a missing toolchain fails naming `scripts/setup-targets` before
 * any build runs, and that a failing build fails the gate.
 */

const NIGHTLY = "nightly-2026-07-29";
const GCC_DIR = "espressif/tools/riscv32-esp-elf/esp-14.2.0_20241119/riscv32-esp-elf/bin";

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
    'echo "$*" >> "$CARGO_LOG"\n' +
      '[[ "$1" == +* ]] && echo "gcc=$(command -v riscv32-esp-elf-gcc)" >> "$CARGO_LOG"\n' +
      '[[ "$*" == *"${FAIL_ON:-@@}"* ]] && exit 7\nexit 0',
  );
  await stub(
    "rustup",
    'case "$*" in\n' +
      `  "toolchain list") echo "1.99.1-x86_64-unknown-linux-gnu (default)"; [[ " $MISSING " == *" nightly "* ]] || echo "${NIGHTLY}-x86_64-unknown-linux-gnu" ;;\n` +
      '  "target list --installed") echo "x86_64-unknown-linux-gnu"; [[ " $MISSING " == *" android-target "* ]] || echo "aarch64-linux-android" ;;\n' +
      `  "component list --installed --toolchain ${NIGHTLY}") echo "cargo-x86_64-unknown-linux-gnu"; [[ " $MISSING " == *" rust-src "* ]] || echo "rust-src" ;;\n` +
      "esac",
  );
  await stub("cargo-ndk", "exit 0");
  await stub("ldproxy", "exit 0");
  await mkdir(join(home, "android-ndk-r27c"), { recursive: true });
  await mkdir(join(home, GCC_DIR), { recursive: true });
  const gcc = join(home, GCC_DIR, "riscv32-esp-elf-gcc");
  await writeFile(gcc, "#!/usr/bin/env bash\nexit 0\n");
  await chmod(gcc, 0o755);
});

afterEach(() => rm(dir, { recursive: true, force: true }));

/** Remove one toolchain piece from the sandbox, or tell `rustup` it is absent. */
async function without(piece: string) {
  if (piece === "cargo-ndk" || piece === "ldproxy") await rm(join(bin, piece));
  else if (piece === "ndk") await rm(join(home, "android-ndk-r27c"), { recursive: true });
  else if (piece === "gcc") await rm(join(home, GCC_DIR, "riscv32-esp-elf-gcc"));
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
  test("builds the workspace for Android, then checks it for ESP-IDF on the pinned nightly", async () => {
    const { code, calls } = await gate();
    expect(code).toBe(0);
    expect(calls[0]).toBe("ndk -t arm64-v8a build --workspace");
    expect(calls[1]).toBe(
      `+${NIGHTLY} check --workspace --target riscv32imafc-esp-espidf -Zbuild-std=std,panic_abort`,
    );
  });

  test("the ESP-IDF build sees riscv32-esp-elf-gcc on PATH", async () => {
    const { calls } = await gate();
    expect(calls[2]).toBe(`gcc=${join(home, GCC_DIR, "riscv32-esp-elf-gcc")}`);
  });

  test("reports how long each target build took", async () => {
    const { stdout } = await gate();
    expect(stdout).toMatch(/aarch64-linux-android: built in \d+s/);
    expect(stdout).toMatch(/riscv32imafc-esp-espidf: built in \d+s/);
  });

  test("an Android build failure fails the gate before the ESP-IDF build", async () => {
    const { code, calls } = await gate({ failOn: "ndk" });
    expect(code).not.toBe(0);
    expect(calls).toEqual(["ndk -t arm64-v8a build --workspace"]);
  });

  test("an ESP-IDF build failure fails the gate", async () => {
    const { code, calls } = await gate({ failOn: "riscv32imafc-esp-espidf" });
    expect(code).not.toBe(0);
    expect(calls[1]).toContain("--target riscv32imafc-esp-espidf");
  });

  test("an ANDROID_NDK_HOME that exists replaces the installed NDK", async () => {
    await without("ndk");
    const own = join(dir, "own-ndk");
    await mkdir(own);
    const { code } = await gate({ ndkHome: own });
    expect(code).toBe(0);
  });

  describe("a missing toolchain piece", () => {
    const pieces = [
      "cargo-ndk",
      "ndk",
      "android-target",
      "nightly",
      "rust-src",
      "ldproxy",
      "gcc",
    ] as const;

    for (const piece of pieces) {
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
      await without("ldproxy");
      await without("gcc");
      const { stderr } = await gate();
      expect(stderr).toContain("ldproxy");
      expect(stderr).toContain("gcc");
    });
  });
});
