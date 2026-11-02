/**
 * BUDGETS: the release binary's size and resident memory after repeated logins, against
 * `scripts/budgets.json` (ADR 0006). `bun run test:budgets`; a long soak is `-- --logins 100000`.
 *
 * Three files, because only one of them can be unit-tested:
 *
 *  * this one — the command. Arguments in, exit code out.
 *  * `./budgets-plan.ts` — the budgets, the readings and the verdict, proved in `./budgets.test.ts`.
 *  * `./budgets-run.ts` — the build, the booted core and the soak. Imported lazily, so `--help`
 *    and the unit suite never load it.
 */

import { HELP, parseArgs, type Args } from "./budgets-plan";

export async function main(argv: readonly string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  const { run } = await import("./budgets-run");
  return run(args.logins);
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
