// fallow-ignore-file coverage-gaps -- drives a live container; run by hand with `bun run bench`.
// The measurements besides the screens (ADR 24): startup, expiry, the background jobs, writes,
// backup and restore, each as table rows.

import { run } from "../smoke.ts";
import {
  type Cgroup,
  cgroup,
  confined,
  coreLog,
  cpuNow,
  create,
  type Peaks,
  sampleMemory,
  writtenNow,
} from "./host.ts";
import { connect, type Core, firstAnswer, probe } from "./http.ts";
import { BUDGETS, measured, perDay, type Row } from "./report.ts";
import { freePort, indexReach, log, type Store } from "./store.ts";

export const MINUTE = 60_000;

/** `crates/synth/src/plant.rs` `PASSWORD`: the admin the generator set up. */
export const PASSWORD = "reference plant";

/** How long the clear-sky index may run before it counts as over its budget. */
const INDEX_CAP = BUDGETS.job.max + 10_000;

export interface Started {
  readonly id: string;
  readonly core: Core;
  readonly group: Cgroup;
  /** Stopped container to first answer, in ms. */
  readonly startup: number;
  /** When the core first answered, by `performance.now()`. */
  readonly answeredAt: number;
}

export interface Boot {
  readonly image: string;
  readonly name: string;
  readonly data: string;
  readonly share: string;
}

/** Creates a core's container on `data` and starts it, timed from stopped to first answer. */
export async function boot(of: Boot): Promise<Started> {
  const listen = `127.0.0.1:${freePort()}`;
  const id = await create({ ...of, listen });
  const core = connect(listen);
  const began = performance.now();

  await run(["docker", "start", id]);

  const startup = await firstAnswer(core.base, began, 5 * MINUTE);
  const answeredAt = performance.now();

  return { id, core, group: await cgroup(id), startup, answeredAt };
}

/**
 * The tick a minute after the core first answers, the first in service, which deletes a full
 * `PRUNE` of blocks past retention. Expiry can only be observed: the catalog queues behind the
 * storage thread, so its slowest answer while the tick runs is how long the tick held it.
 */
export async function expiryTick(started: Started): Promise<Row> {
  const { core, group, answeredAt } = started;

  await Bun.sleep(answeredAt + MINUTE - 5000 - performance.now());

  const before = await cpuNow(group);
  // A catalog answer costs about 24 ms of CPU: back to back they would spend the quota and time
  // the throttling. A 50 ms gap still meets any tick that holds the thread longer than it.
  const storage = probe(core, "/api/v1/series", 50);

  // The tick fires 60 to 61 s after the first answer.
  await Bun.sleep(10_000);

  const worst = await storage.stop();
  const after = await cpuNow(group);

  log(
    `expiry tick: ${(after.usage - before.usage).toFixed(0)} ms of CPU in the window, throttled ${(after.throttled - before.throttled).toFixed(0)} ms`,
  );

  return {
    measurement: "first expiry tick, storage thread held",
    budget: BUDGETS.expiry,
    result: worst,
  };
}

/** What `work` returned, and the bytes the idle core wrote while it ran, scaled to a day. */
export interface Meanwhile<T> {
  readonly writes: Row;
  readonly done: T;
}

/** Counts the idle core's writes for as long as `work`, in other containers, takes. */
export async function writesWhile<T>(group: Cgroup, work: () => Promise<T>): Promise<Meanwhile<T>> {
  const [before, began] = [await writtenNow(group), performance.now()];
  const done = await work();
  const window = performance.now() - began;

  const writes = {
    measurement: `writes a day, idle core, ${(window / 1000).toFixed(0)} s of block I/O scaled`,
    budget: BUDGETS.writes,
    result: perDay((await writtenNow(group)) - before, window),
  };

  return { writes, done };
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

/** The time from `began` until the core uses under a tenth of a CPU over 2 s; `null` past `cap`. */
export async function untilIdle(group: Cgroup, began: number, cap: number): Promise<number | null> {
  const before = await cpuNow(group);
  const at = performance.now();

  await Bun.sleep(2000);

  if ((await cpuNow(group)).usage - before.usage < 200) return at - began;

  if (performance.now() - began > cap) return null;

  return untilIdle(group, began, cap);
}

/** The index's rows, and the memory its recompute took. */
export interface Recomputed {
  readonly rows: readonly Row[];
  readonly peaks: Peaks;
}

const NO_PEAKS: Peaks = { workingSet: 0, anon: 0, resident: 0 };

/**
 * Starts a core on a file without its clear-sky index, which it then computes over the whole
 * history: the time until it idles, given up past the budget, and the I/O thread's worst answer
 * meanwhile.
 */
export async function clearSkyIndex(of: Boot, file: string): Promise<Recomputed> {
  const measurement = "clear-sky index over the full history, start to idle";

  try {
    const began = performance.now();
    const started = await boot(of);

    await started.core.signIn(PASSWORD);

    const memory = sampleMemory(started.group);
    const io = probe(started.core, "/api/v1/session", 10);
    const busy = await untilIdle(started.group, began, INDEX_CAP);
    const worst = await io.stop();
    const peaks = await memory.stop();

    log(`core log:\n${await coreLog(started.id, 8)}`);
    await run(["docker", "rm", "-f", started.id]);
    const reach = indexReach(file);

    log(`clear-sky index: ${Number.isNaN(reach) ? "none" : new Date(reach).toISOString()}`);

    const rows: Row[] = [
      busy === null
        ? { measurement, budget: BUDGETS.job, failed: `> ${BUDGETS.job.max / 1000} s` }
        : { measurement, budget: BUDGETS.job, result: busy },
      { measurement: "I/O thread worst meanwhile", budget: BUDGETS.ioThread, result: worst },
    ];

    return { rows, peaks };
  } catch (error) {
    return { rows: [{ measurement, budget: BUDGETS.job, failed: String(error) }], peaks: NO_PEAKS };
  }
}

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
