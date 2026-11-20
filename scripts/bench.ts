// fallow-ignore-file coverage-gaps -- needs Docker and the ten-year file; run by hand with `bun run bench`.
// The performance benchmark (ADR 24): the release image at 0.5 CPU and 64 MB on a copy of the
// reference plant's ten years, each measurement printed beside its budget. Never in the gate.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { type Cgroup, cgroup, coreLog, create, higher, type Peaks } from "./bench/host.ts";
import { sampleMemory } from "./bench/host.ts";
import { type Core, connect, firstAnswer } from "./bench/http.ts";
import * as phase from "./bench/phases.ts";
import { plantAt } from "./bench/plant.ts";
import { BUDGETS, type Row, table } from "./bench/report.ts";
import { coldScreens } from "./bench/screen-runs.ts";
import * as store from "./bench/store.ts";
import { run } from "./smoke.ts";

const { log, ROOT } = store;

interface Dirs {
  readonly data: string;
  readonly share: string;
  readonly restored: string;
}

async function dirs(work: string): Promise<Dirs> {
  const [data, share, restored] = [join(work, "data"), join(work, "share"), join(work, "restore")];

  await Promise.all([data, share, restored].map((dir) => mkdir(dir, { recursive: true })));

  return { data, share, restored };
}

interface Started {
  readonly id: string;
  readonly core: Core;
  readonly group: Cgroup;
  readonly startup: number;
  /** When the core first answered, by `performance.now()`. */
  readonly answeredAt: number;
}

/** Creates the core's container on `where` and starts it, timed from stopped to first answer. */
async function boot(image: string, name: string, where: Dirs): Promise<Started> {
  const listen = `127.0.0.1:${store.freePort()}`;
  const id = await create({ image, name, data: where.data, share: where.share, listen });
  const core = connect(listen);
  const began = performance.now();

  await run(["docker", "start", id]);

  const startup = await firstAnswer(core.base, began, 5 * phase.MINUTE);
  const answeredAt = performance.now();

  return { id, core, group: await cgroup(id), startup, answeredAt };
}

/** The reads, expiry, writes and backup on the running core; the core stopped afterwards. */
/** What one start of the core measured. */
interface Ran {
  readonly rows: readonly Row[];
  readonly peaks: Peaks;
}

/** The reads, expiry, writes and backup on the running core; the core stopped afterwards. */
async function whileRunning(started: Started, held: store.Store, data: string): Promise<Ran> {
  const { core, group, answeredAt } = started;
  const memory = sampleMemory(group);

  await core.signIn(phase.PASSWORD);

  const plant = await plantAt(core, held.end);

  log(`screens open at ${new Date(plant.now).toISOString()}`);

  const screens = await coldScreens(core, plant);
  const tick = await phase.expiryTick(core, group, answeredAt);

  await phase.drained(held, answeredAt);

  const reads = await screens.warm();
  const writes = await phase.writesPerDay(group);
  const size = await store.sizeOf(data);
  const saved = await phase.backup(core);
  const peaks = await memory.stop();

  log(`core log:\n${await coreLog(started.id, 15)}`);
  await run(["docker", "stop", "-t", "10", started.id]);

  const startup = started.startup;

  const rows: Row[] = [
    {
      measurement: "startup, stopped container to first answer",
      budget: BUDGETS.startup,
      result: startup,
    },
    ...reads,
    ...tick,
    saved,
    { measurement: "file size", budget: null, result: size, unit: "bytes" },
    writes,
  ];

  return { rows, peaks };
}

/** Peak memory over both starts of the core. */
function memoryRows(peaks: Peaks): Row[] {
  return [
    {
      measurement: "peak memory, cgroup less inactive file cache, sampled",
      budget: BUDGETS.memory,
      result: peaks.workingSet,
    },
    {
      measurement: "peak anonymous memory, sampled",
      budget: null,
      result: peaks.anon,
      unit: "bytes",
    },
    {
      measurement: "peak resident set (VmHWM)",
      budget: null,
      result: peaks.resident,
      unit: "bytes",
    },
  ];
}

/** Everything measured on one copy of the cached file. */
async function measure(image: string, name: string, work: string): Promise<Row[]> {
  const where = await dirs(work);
  const file = await store.copy(await store.cachedFile(), where.data);
  const held = store.inspect(file);

  await Promise.all(held.ports.map((port) => store.unreachable(port)));
  log(`schema ${held.version}, data to ${new Date(held.end).toISOString()}`);

  const started = await boot(image, name, where);
  const running = await whileRunning(started, held, where.data);
  const restored = await phase.restore({ image, name, share: where.share, into: where.restored });
  const index = await phase.clearSkyIndex(started.id, started.core, file);

  return [
    ...running.rows,
    ...memoryRows(higher(running.peaks, index.peaks)),
    ...phase.UNMEASURED,
    ...index.rows,
    restored,
    phase.migration(held, await store.currentSchema()),
  ];
}

async function main(): Promise<number> {
  const image = await store.buildImage();
  const name = `sunreye-bench-${process.pid}`;
  const work = await mkdtemp(join(ROOT, "target", "bench", "run-"));

  const cleanUp = async (): Promise<void> => {
    await run(["docker", "rm", "-f", name]).catch(() => "");
    await run(["docker", "image", "rm", image]).catch(() => "");
    await rm(work, { recursive: true, force: true });
  };

  // An interrupted run would leave the container and a copy of the whole file behind.
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void cleanUp().finally(() => process.exit(130));
    });

  try {
    const { lines, breaches } = table(await measure(image, name, work));

    process.stdout.write(`${lines.join("\n")}\n`);
    log(breaches === 0 ? "every budget kept" : `${breaches} breached`);

    return breaches === 0 ? 0 : 1;
  } finally {
    await cleanUp();
  }
}

process.exitCode = await main();
