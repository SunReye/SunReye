import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The `profile` entry point dispatches on argv at import, so it is exercised as
// a child process: what a CI gate or pre-commit hook actually sees.
const cliPath = join(import.meta.dir, "cli.ts");
const fixturePath = join(import.meta.dir, "__fixtures__/sample-profile.json");

async function runCli(...args: string[]) {
  const proc = Bun.spawn(["bun", cliPath, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("profile CLI", () => {
  test("exits 1 with the usage line for an unknown command", async () => {
    const { stderr, exitCode } = await runCli("frobnicate");
    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      "usage: profile <init|upgrade|validate|coverage|replay|scaffold|build>",
    );
  });

  test("exits 1 with the usage line when no command is given", async () => {
    const { stderr, exitCode } = await runCli();
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage: profile");
  });

  test("dispatches to the command and exits 0 on a valid profile", async () => {
    const { stdout, exitCode } = await runCli("validate", fixturePath);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("is a valid profile");
  });

  // The dispatch itself: `replay` takes variadic positionals *then* flags, the
  // same split as `build`. A unit test on cmdReplay cannot prove argv reaches it
  // that way, and getting the split wrong would silently pass a `--profile`
  // value in as a capture path.
  describe("profile replay", () => {
    const capture = (body: unknown): string => {
      const dir = mkdtempSync(join(tmpdir(), "profile-cli-replay-"));
      const path = join(dir, "capture.json");
      writeFileSync(path, JSON.stringify(body));
      return path;
    };

    // 672/673 are dc.pv1.power / dc.pv2.power in the fixture; dc.total_power is
    // their computed sum, so this covers the whole decode + compute path.
    const good = {
      profile: "deye-sg05lp3",
      registers: { "672": 1200, "673": 800 },
      expect: { "dc.pv1.power": 1200, "dc.total_power": 2000 },
    };

    test("a passing capture exits 0 through the real argv path", async () => {
      const { stdout, exitCode } = await runCli("replay", capture(good), "--profile", fixturePath);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("dc.total_power");
    });

    test("a failing capture exits 1 and names the metric", async () => {
      const { stderr, exitCode } = await runCli(
        "replay",
        capture({ ...good, expect: { "dc.total_power": 1 } }),
        "--profile",
        fixturePath,
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain("dc.total_power");
    });

    test("several captures are accepted before the flags", async () => {
      const { exitCode } = await runCli(
        "replay",
        capture(good),
        capture(good),
        "--profile",
        fixturePath,
      );
      expect(exitCode).toBe(0);
    });

    test("no capture path is a usage error, not a crash", async () => {
      const { stderr, exitCode } = await runCli("replay");
      expect(exitCode).toBe(1);
      expect(stderr).toContain("usage: profile replay");
    });
  });
});
