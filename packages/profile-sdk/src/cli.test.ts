import { describe, expect, test } from "bun:test";
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
    expect(stderr).toContain("usage: profile <init|upgrade|validate|coverage|scaffold|build>");
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
});
