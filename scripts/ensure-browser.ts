#!/usr/bin/env bun
/**
 * Install Chromium for the component and browser layers only when it is missing.
 *
 * `playwright install --with-deps` always takes the apt lock, so parallel factory slots collided on
 * it. A browser that already launches needs nothing; a missing one is installed, and a held lock is
 * retried a bounded number of times.
 *
 * Usage: `bun scripts/ensure-browser.ts`
 */

export interface Install {
  code: number;
  output: string;
}
export type Probe = () => Promise<boolean>;

export interface Deps {
  probe: Probe;
  install: () => Promise<Install>;
  sleep: (ms: number) => Promise<void>;
}
export interface Retry {
  attempts: number;
  delayMs: number;
}

const APT_LOCK = "/var/lib/dpkg/lock-frontend";
const LOCK_HELD = /Could not get lock|Unable to acquire the dpkg frontend lock/;
const WEB = new URL("../apps/web", import.meta.url).pathname;

const lockHeld = (run: Install) => run.code !== 0 && LOCK_HELD.test(run.output);

/** "present" when a browser already launches, "installed" when this call put one there. */
export async function ensureBrowser(
  deps: Deps,
  { attempts, delayMs }: Retry = { attempts: 30, delayMs: 10_000 },
): Promise<"present" | "installed"> {
  if (await deps.probe()) return "present";
  for (let attempt = 1; ; attempt++) {
    const run = await deps.install();
    if (run.code === 0) return "installed";
    if (!lockHeld(run)) {
      throw new Error(
        `${run.output}\nbrowser install failed: run \`bun run e2e:install\` and fix the error above`,
      );
    }
    if (attempt >= attempts) {
      throw new Error(
        `${APT_LOCK} held through ${attempts} attempts: wait for the other apt process, then rerun scripts/ci`,
      );
    }
    await deps.sleep(delayMs);
    if (await deps.probe()) return "present";
  }
}

async function run(cmd: string[], cwd: string): Promise<Install> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, output: out + err };
}

/** Deps that run `probe` and `install` as commands in `cwd`; `warn` reports each lock wait. */
export function commandDeps(
  cmds: { probe: string[]; install: string[] },
  cwd: string,
  warn: (line: string) => void = console.error,
): Deps {
  return {
    probe: async () => (await run(cmds.probe, cwd)).code === 0,
    install: () => run(cmds.install, cwd),
    sleep: (ms) => {
      warn(`${APT_LOCK} held: retrying in ${ms / 1000}s`);
      return Bun.sleep(ms);
    },
  };
}

/** Process exit code: 0 when a browser is there, 1 with the failure printed. */
export async function main(deps: Deps): Promise<number> {
  try {
    console.log(`chromium ${await ensureBrowser(deps)}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

const LAUNCH = `import { chromium } from "@playwright/test"; await (await chromium.launch()).close();`;

if (import.meta.main) {
  const cmds = { probe: ["bun", "-e", LAUNCH], install: ["bun", "run", "e2e:install"] };
  process.exit(await main(commandDeps(cmds, WEB)));
}
