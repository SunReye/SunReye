/**
 * ROUTE SMOKE: boot the Rust core and ask every route in the OpenAPI listing
 * whether it answers, and whether it answers only whom it should.
 *
 * A 5xx fails the run, and so does a request that never came back. The listing
 * is then swept with no credentials and as a plain account: everything outside
 * the declared public list must refuse the stranger, and only the session list
 * may answer the plain account.
 *
 * Three files, because only one of them can be unit-tested:
 *
 *  * this one — the command. Arguments in, exit code out.
 *  * `./route-smoke-plan.ts` — the plan, the sampling and the verdicts, proved
 *    in `./route-smoke.test.ts`.
 *  * `./route-smoke-run.ts` — the build, the booted core and the sweep.
 *    Imported LAZILY, so `--help` and the unit suite never load it.
 *
 * Run `bun scripts/route-smoke.ts --help`, or `bun run test:routes`.
 */

import { HELP, type SmokeOptions, parseArgs } from "./route-smoke-plan";

/** Parsed options, or `undefined` after reporting why there are none. */
function readOptions(argv: readonly string[]): SmokeOptions | undefined {
  try {
    return parseArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    return undefined;
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = readOptions(argv);
  if (!options) return 1;
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  const { run } = await import("./route-smoke-run");
  return run();
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
