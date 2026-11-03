import { describe, expect, test } from "bun:test";
import { type Install, type Probe, commandDeps, ensureBrowser, main } from "./ensure-browser";

const LOCK_OUTPUT =
  "E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 4242 (apt-get)";

function harness(probes: boolean[], installs: Install[]) {
  const calls = { probe: 0, install: 0, sleeps: [] as number[] };
  const probe: Probe = async () => probes[Math.min(calls.probe++, probes.length - 1)] as boolean;
  const install = async () => installs[Math.min(calls.install++, installs.length - 1)] as Install;
  const sleep = async (ms: number) => void calls.sleeps.push(ms);
  return { calls, deps: { probe, install, sleep } };
}

const ok: Install = { code: 0, output: "" };
const locked: Install = { code: 100, output: LOCK_OUTPUT };

describe("ensureBrowser", () => {
  test("a browser that launches skips the install", async () => {
    const { calls, deps } = harness([true], [ok]);
    expect(await ensureBrowser(deps)).toBe("present");
    expect(calls.install).toBe(0);
  });

  test("a browser that does not launch is installed", async () => {
    const { calls, deps } = harness([false], [ok]);
    expect(await ensureBrowser(deps)).toBe("installed");
    expect(calls.install).toBe(1);
  });

  test("a held apt lock is retried, then the install goes through", async () => {
    const { calls, deps } = harness([false], [locked, locked, ok]);
    expect(await ensureBrowser(deps, { attempts: 5, delayMs: 7 })).toBe("installed");
    expect(calls.install).toBe(3);
    expect(calls.sleeps).toEqual([7, 7]);
  });

  test("a lock held through every attempt fails with its location and the fix", async () => {
    const { calls, deps } = harness([false], [locked]);
    const failure = ensureBrowser(deps, { attempts: 3, delayMs: 7 });
    await expect(failure).rejects.toThrow(
      "/var/lib/dpkg/lock-frontend held through 3 attempts: wait for the other apt process, then rerun scripts/ci",
    );
    expect(calls.install).toBe(3);
    expect(calls.sleeps).toEqual([7, 7]);
  });

  test("the lock being freed by a parallel slot's own install makes the browser present", async () => {
    const { calls, deps } = harness([false, true], [locked]);
    expect(await ensureBrowser(deps, { attempts: 5, delayMs: 7 })).toBe("present");
    expect(calls.install).toBe(1);
  });

  test("any other install failure is not retried and shows its output", async () => {
    const broken: Install = { code: 1, output: "E: Unable to locate package libfoo" };
    const { calls, deps } = harness([false], [broken]);
    const failure = ensureBrowser(deps, { attempts: 5, delayMs: 7 });
    await expect(failure).rejects.toThrow("E: Unable to locate package libfoo");
    await expect(failure).rejects.toThrow("run `bun run e2e:install` and fix the error above");
    expect(calls.install).toBe(1);
    expect(calls.sleeps).toEqual([]);
  });

  test("apt's other lock wording counts as a held lock", async () => {
    const waiting: Install = {
      code: 100,
      output: "E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend)",
    };
    const { calls, deps } = harness([false], [waiting, ok]);
    expect(await ensureBrowser(deps, { attempts: 2, delayMs: 1 })).toBe("installed");
    expect(calls.install).toBe(2);
  });
});

describe("commandDeps", () => {
  const sh = (script: string) => ["sh", "-c", script];
  const deps = (probe: string[], install: string[], warn = (_line: string) => {}) =>
    commandDeps({ probe, install }, ".", warn);

  test("the probe is the command's exit status", async () => {
    expect(await deps(sh("exit 0"), sh("exit 0")).probe()).toBe(true);
    expect(await deps(sh("exit 1"), sh("exit 0")).probe()).toBe(false);
  });

  test("the install returns the exit status with stdout and stderr", async () => {
    const run = await deps(sh("exit 0"), sh("echo out; echo err >&2; exit 100")).install();
    expect(run.code).toBe(100);
    expect(run.output).toContain("out");
    expect(run.output).toContain("err");
  });

  test("a wait names the lock and the delay", async () => {
    const lines: string[] = [];
    await deps(sh("exit 0"), sh("exit 0"), (line) => void lines.push(line)).sleep(1);
    expect(lines).toEqual(["/var/lib/dpkg/lock-frontend held: retrying in 0.001s"]);
  });
});

describe("main", () => {
  test("exits 0 when a browser is present", async () => {
    expect(await main(harness([true], [ok]).deps)).toBe(0);
  });

  test("exits 1 when the install fails", async () => {
    const failed: Install = { code: 1, output: "E: boom" };
    expect(await main(harness([false], [failed]).deps)).toBe(1);
  });
});
