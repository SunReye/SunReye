// fallow-ignore-file coverage-gaps -- drives a live container; run by hand with `bun run bench`.
// The measurements besides the screens (ADR 24): expiry, the background jobs, writes, backup and
// restore, each as table rows.

import { run } from "../smoke.ts";
import {
  type Cgroup,
  cgroup,
  confined,
  coreLog,
  cpuNow,
  type Peaks,
  sampleMemory,
  writtenNow,
} from "./host.ts";
import { type Core, firstAnswer, probe } from "./http.ts";
import { BUDGETS, measured, type Row } from "./report.ts";
import { forgetIndex, indexReach, log, type Store } from "./store.ts";

export const MINUTE = 60_000;

/** `crates/synth/src/plant.rs` `PASSWORD`: the admin the generator set up. */
export const PASSWORD = "reference plant";

/** How long bytes written are counted, scaled to a day. */
const WINDOW = 10 * MINUTE;

/** Probes the storage thread and the I/O thread for `ms`; their worst latencies. */
async function probed(core: Core, group: Cgroup, ms: number): Promise<number[]> {
  const before = await cpuNow(group);
  // The catalog queues behind the storage thread; the session never leaves the I/O thread.
  const probes = [probe(core, "/api/v1/series"), probe(core, "/api/v1/session")];

  await Bun.sleep(ms);

  const worst = await Promise.all(probes.map((p) => p.stop()));
  const throttled = (await cpuNow(group)).throttled - before.throttled;

  log(
    `probed ${ms} ms: worst ${worst.map((w) => w.toFixed(0)).join(" / ")} ms, throttled ${throttled.toFixed(0)} ms`,
  );

  return worst;
}

/**
 * A minute tick while the expiry backlog lasts. Expiry can only be observed: storage ticks a
 * minute after the core first answers, and holds its thread for as long as the tick takes.
 */
export async function expiryTick(core: Core, group: Cgroup, answeredAt: number): Promise<Row[]> {
  const minute = Math.ceil((performance.now() - answeredAt + 5000) / MINUTE);

  await Bun.sleep(answeredAt + minute * MINUTE - 5000 - performance.now());

  const [storage = Number.NaN, io = Number.NaN] = await probed(core, group, 15_000);

  return [
    {
      measurement: `expiry tick at minute ${minute}, storage thread held`,
      budget: BUDGETS.expiry,
      result: storage,
    },
    { measurement: "I/O thread worst during that tick", budget: null, result: io, unit: "ms" },
  ];
}

/** Waits until the first ticks have expired every block already past retention. */
export async function drained(store: Store, answeredAt: number): Promise<void> {
  const ticks = Math.ceil(store.backlog / (16 * 256));
  const wait = answeredAt + (ticks - 1) * MINUTE + 20_000 - performance.now();

  log(`${store.backlog} blocks past retention: waiting ${Math.max(0, wait / 1000).toFixed(0)} s`);
  await Bun.sleep(Math.min(Math.max(0, wait), 40 * MINUTE));
}

/** Bytes written over `WINDOW` by an idle core, scaled to a day. */
export async function writesPerDay(group: Cgroup): Promise<Row> {
  const before = await writtenNow(group);

  await Bun.sleep(WINDOW);

  return {
    measurement: `writes a day, idle core, ${WINDOW / MINUTE} min of block I/O scaled`,
    budget: BUDGETS.writes,
    result: ((await writtenNow(group)) - before) * (86_400_000 / WINDOW),
  };
}

export async function backup(core: Core): Promise<Row> {
  const body = JSON.stringify({ name: "bench.tar" });

  const answer = await core.time({
    path: "/api/v1/backups",
    method: "POST",
    body,
    timeout: 30 * MINUTE,
  });

  return measured("backup through the API", BUDGETS.backup, answer.ms, answer.error);
}

export interface Restore {
  readonly image: string;
  readonly name: string;
  readonly share: string;
  readonly into: string;
}

/** `sunreye restore` of the backup, in a container of its own as a stopped core's would be. */
export async function restore(of: Restore): Promise<Row> {
  const began = performance.now();
  const measurement = "restore with `sunreye restore`";

  try {
    await run([
      "docker",
      "run",
      "--rm",
      ...confined(`${of.name}-restore`),
      "-v",
      `${of.share}:/share`,
      "-v",
      `${of.into}:/restore`,
      of.image,
      "restore",
      "/share/bench.tar",
      "--data-dir",
      "/restore",
    ]);

    return { measurement, budget: null, result: performance.now() - began, unit: "ms" };
  } catch (error) {
    return { measurement, budget: null, failed: String(error) };
  }
}

/** The time until the core uses under a tenth of a CPU over 5 s, from `began`. */
async function untilIdle(group: Cgroup, began: number): Promise<number> {
  const before = await cpuNow(group);
  const at = performance.now();

  await Bun.sleep(5000);

  if ((await cpuNow(group)).usage - before.usage < 500) return at - began;

  if (performance.now() - began > 30 * MINUTE) return Number.POSITIVE_INFINITY;

  return untilIdle(group, began);
}

/**
 * Restarts on the file without its clear-sky index, which the core then computes over the whole
 * history: the time until it idles, and the I/O thread's worst answer meanwhile.
 */
export async function clearSkyIndex(id: string, core: Core, file: string): Promise<Recomputed> {
  const measurement = "clear-sky index over the full history, restart to idle";

  try {
    forgetIndex(file);

    const began = performance.now();

    await run(["docker", "start", id]);
    await firstAnswer(core.base, began, 5 * MINUTE);
    await core.signIn(PASSWORD);

    const group = await cgroup(id);
    const memory = sampleMemory(group);
    const throttled = (await cpuNow(group)).throttled;
    const io = probe(core, "/api/v1/session");
    const busy = await untilIdle(group, began);
    const worst = await io.stop();
    const peaks = await memory.stop();

    log(
      `clear-sky index: throttled ${((await cpuNow(group)).throttled - throttled).toFixed(0)} ms`,
    );
    log(`core log:\n${await coreLog(id, 15)}`);
    await run(["docker", "stop", "-t", "10", id]);
    log(`clear-sky index computed up to ${new Date(indexReach(file)).toISOString()}`);

    const rows: Row[] = [
      Number.isFinite(busy)
        ? { measurement, budget: BUDGETS.job, result: busy }
        : {
            measurement,
            budget: BUDGETS.job,
            failed: "still busy when the harness gave up at 30 min",
          },
      { measurement: "I/O thread worst meanwhile", budget: BUDGETS.ioThread, result: worst },
    ];

    return { rows, peaks };
  } catch (error) {
    return { rows: [{ measurement, budget: BUDGETS.job, failed: String(error) }], peaks: NO_PEAKS };
  }
}

/** The index's rows, and the memory the recompute took. */
export interface Recomputed {
  readonly rows: readonly Row[];
  readonly peaks: Peaks;
}

const NO_PEAKS: Peaks = { workingSet: 0, anon: 0, resident: 0 };

/** What the harness cannot run on an offline core whose wall clock is past the file's end. */
export const UNMEASURED: readonly Row[] = [
  {
    measurement: "learned corrections",
    budget: BUDGETS.job,
    skipped: "the learner fetches archive weather over HTTPS before it learns; the core is offline",
  },
  {
    measurement: "forecast refresh",
    budget: BUDGETS.job,
    skipped:
      "a refresh issues from the wall clock on; the file's weather targets end a week after it",
  },
];

export function migration(store: Store, current: number): Row {
  const measurement = "migration from an earlier schema";

  return {
    measurement,
    budget: null,
    skipped:
      store.version === current
        ? `not applicable, the cache is at schema ${current}, the current one`
        : `the cache is at schema ${store.version}: its migration is inside startup`,
  };
}
