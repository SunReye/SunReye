/**
 * THE IN-PLACE 1.2.0 -> 2.0.0 UPGRADE, rehearsed end to end against the real
 * addon-1.2.0 fixture.
 *
 * There is ONE production instance, it holds ~2 months of real history, the
 * upgrade gets ONE attempt, and no user-performed export exists beforehand. The
 * fixture is therefore the only proof available, and this script is how the proof
 * is taken: it restores a schema-exact 1.2.0 database and runs the SHIPPED code
 * over it — `runMigrations` for the blocking step, `runBackfill` for the data,
 * `verifyMigration` for the gate, `dropLegacyStatements` for the end — measuring
 * each and comparing the result with the fixture's COMMITTED ground truth using
 * the fixture's own differs.
 *
 * ## Why it is phased, and why the state lives in the database
 *
 * `--phase` runs one step and stops. That is not a convenience: the upgrade's
 * whole resumability story is that the state is IN THE DATABASE (the migration
 * record and `replay_progress`), so the only honest way to prove a killed run
 * resumes is to kill the process and start a new one. A single long-lived script
 * that "simulated" a kill by throwing would keep its own memory and prove
 * nothing. So:
 *
 *   bun scripts/upgrade-rehearsal.ts --phase=restore
 *   bun scripts/upgrade-rehearsal.ts --phase=blocking
 *   bun scripts/upgrade-rehearsal.ts --phase=provision
 *   bun scripts/upgrade-rehearsal.ts --phase=backfill --stop-after=8   # then SIGKILL
 *   bun scripts/upgrade-rehearsal.ts --phase=backfill                  # resumes
 *   bun scripts/upgrade-rehearsal.ts --phase=verify
 *   bun scripts/upgrade-rehearsal.ts --phase=drop
 *
 * `--phase=all` runs the lot.
 *
 * ## What it proves that the database tests do not
 *
 * `apps/server/db-tests/upgrade.test.ts` proves the statements against a seeded
 * span in seconds. This proves the two things only the real fixture can answer:
 * that the numbers come out right across the whole ~2-month span with the mid-day
 * counter cliff inside it, and HOW LONG the thing takes — which is what decided
 * that the backfill cannot live in the addon's boot chain.
 *
 * ## Safety
 *
 * This script DROPs its target database. Port 5432 on this host is the
 * developer's dev database, SHARED WITH A LIVE GRID-TIED INVERTER, and port 5433
 * is the addon-1.2.0 fixture container, which is expensive to rebuild and must
 * stay READ-ONLY. Both are refused by {@link assertUpgradeTarget}, in the same
 * spirit as `fixture-1-2-0.ts` and `apps/server/db-tests/harness.ts` pinning
 * theirs.
 *
 * Run `bun scripts/upgrade-rehearsal.ts --help`.
 */
process.env.SKIP_ENV_VALIDATION ??= "1";

import { type GroundTruth, groundTruthPath } from "./fixture-1-2-0";
import {
  type Options,
  type Phase,
  HELP,
  log,
  parseArgs,
  phasesToRun,
  report,
} from "./upgrade-plan";

/**
 * The Docker/Postgres driver, loaded only when a phase actually runs.
 *
 * LAZY on purpose. `./upgrade-phases.ts` exists to dial containers; importing it
 * to parse `--help`, or from a unit test of the port pinning, would load a module
 * with no business being loaded. It also keeps the driver out of the coverage
 * report, where an untestable 460-line shell would otherwise read as neglected
 * code and bury the parts that genuinely are tested.
 */
const phases = () => import("./upgrade-phases");

/**
 * What each phase runs. A table rather than a chain of `if`s so the ORDER lives
 * in one place ({@link phasesToRun}) and the work in another — the two things a
 * reader of this script needs to separate.
 *
 * `restore` returns no problems because it has none to report: it either restores
 * or throws, and a half-restored database is not something to carry on from.
 */
const PHASE_RUNNERS: Record<
  Exclude<Phase, "all">,
  (options: Options, truth: GroundTruth) => Promise<string[]>
> = {
  restore: async (options) => {
    await (await phases()).restore(options);
    return [];
  },
  blocking: async (options, truth) => (await phases()).blocking(options, truth),
  provision: async (options) => (await phases()).provision(options),
  backfill: async (options) => (await phases()).backfill(options),
  verify: async (options, truth) => (await phases()).verify(options, truth),
  drop: async (options) => (await phases()).drop(options),
};

// fallow-ignore-next-line complexity -- CRAP only, not complexity: cyclomatic 6 and cognitive 6 are both well inside the repo's limits of 10. CRAP squares the complexity when unit coverage is zero, and this function's coverage is zero BY DESIGN — it loads the ground truth, then drives Docker and Postgres through six phases, which no unit test can stand in for. It is exercised by running the rehearsal end to end against the restored addon-1.2.0 fixture, which is the only proof that means anything here.
export async function main(argv: readonly string[]): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  try {
    const truth = (await Bun.file(groundTruthPath(options.mode)).json()) as GroundTruth;
    log(
      `ground truth: ${options.mode} fixture, ${truth.fixture.spanDays} days x ` +
        `${truth.fixture.metricCount} metrics at ${truth.fixture.cadenceSeconds}s, ` +
        `${truth.restarts.length} counter restarts`,
    );
    const problems: string[] = [];
    for (const phase of phasesToRun(options.phase)) {
      log(`--- phase: ${phase} ---`);
      problems.push(...(await PHASE_RUNNERS[phase](options, truth)));
      // STOP at the first phase that found something. Every later phase assumes
      // the earlier one succeeded — verifying a backfill that failed halfway, or
      // DROPPING the rollback after a verification that reported problems, is how
      // a rehearsal turns into the incident it exists to prevent.
      if (problems.length > 0) break;
    }
    return report(problems);
  } catch (error) {
    console.error(error);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
