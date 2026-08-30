/**
 * ROUTE SMOKE: boot the real server against a throwaway TimescaleDB and ask
 * every route in the OpenAPI listing whether it can answer at all.
 *
 * The gap this closes is named in `route-layer-has-no-automated-cover`: the
 * unit suite stops below `apps/server/src/routes/*`, the browser suite fakes
 * the backend entirely (`apps/web/e2e/support/api-mock.ts` — no Elysia, no
 * Postgres, no inverter), and the database suite proves statements without the
 * handlers that compose them. Two 500s shipped behind a fully green suite that
 * way: an ambiguous `time_bucket` overload, and an `ORDER BY` that bound to a
 * UNION instead of its arm. Both were a booted server away from being obvious.
 *
 * A 5xx fails the run, and so does a request that never came back. Nothing
 * else — a 4xx means the handler RAN and refused the input, which is exactly
 * what a probe carrying an empty body and a placeholder id deserves. Response
 * shapes are out of scope by design; correctness stays in the unit and database
 * suites. This layer answers one question: does the route execute.
 *
 * Three files, because only one of them can be unit-tested:
 *
 *  * this one — the command. Arguments in, exit code out.
 *  * `./route-smoke-plan.ts` — the pinning, the plan, the sampling and the
 *    verdicts, all provable without a container, and proved in
 *    `./route-smoke.test.ts`.
 *  * `./route-smoke-run.ts` — Docker, migrations, a booted server and the
 *    sweep. Imported LAZILY, so `--help` and the unit suite never load it, and
 *    it never lands in the coverage report as apparently-neglected code.
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
  return run(options);
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
