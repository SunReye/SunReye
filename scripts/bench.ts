// fallow-ignore-file coverage-gaps -- needs Docker and the ten-year file; run by hand with `bun run bench`.
// The performance benchmark (ADR 24): the release image at 0.5 CPU and 64 MB on a copy of the
// reference plant's ten years, each measurement printed beside its budget. Never in the gate.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { coreLog, higher, type Peaks, sampleMemory } from "./bench/host.ts";
import * as phase from "./bench/phases.ts";
import { plantAt } from "./bench/plant.ts";
import { BUDGETS, type Row, table } from "./bench/report.ts";
import { coldScreens, type Pause } from "./bench/screen-runs.ts";
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

/** The longest warm open, so none runs into the expiry tick's window. */
const LONGEST_OPEN = 5000;

/**
 * Takes the first expiry tick when the next open could reach its window; the screens open in the
 * idle minute before it, never during it.
 */
interface Tick {
  readonly pause: Pause;
  readonly row: () => Promise<Row>;
}

function tickBetweenOpens(started: phase.Started): Tick {
  let tick: Promise<Row> | null = null;
  const take = (): Promise<Row> => (tick ??= phase.expiryTick(started));

  return {
    pause: async () => {
      const window = started.answeredAt + phase.MINUTE - 5000;

      if (tick === null && performance.now() + LONGEST_OPEN > window) await take();
    },
    row: take,
  };
}

/** What one start of the core measured. */
interface Ran {
  readonly rows: readonly Row[];
  readonly peaks: Peaks;
}

/**
 * Restore of the backup into `of.data`, then the clear-sky index computed on the restored file.
 * Each runs in its own container beside the first core, which only idles: neither counts the
 * other's CPU or writes.
 */
async function alongside(of: phase.Boot): Promise<Ran> {
  const restored = await phase.restore({
    image: of.image,
    name: of.name,
    share: of.share,
    into: of.data,
  });

  const file = join(of.data, "core.sqlite");

  store.forgetIndex(file);
  await store.evict(file);

  const index = await phase.clearSkyIndex(of, file);

  return { rows: [restored, ...index.rows], peaks: index.peaks };
}

/**
 * The screens, expiry, backup and writes on the core started on `data`; its writes are counted
 * while it idles through restore and the clear-sky index, each in a container of its own.
 */
async function measureCore(of: phase.Boot, held: store.Store, restored: string): Promise<Ran> {
  const started = await phase.boot(of);
  const memory = sampleMemory(started.group);

  await started.core.signIn(phase.PASSWORD);

  const plant = await plantAt(started.core, held.end);

  log(`screens open at ${new Date(plant.now).toISOString()}`);

  const screens = await coldScreens(started.core, plant);

  // The core settles its startup jobs within seconds; warm opens wait for it.
  await phase.untilIdle(started.group, performance.now(), phase.MINUTE);

  const tick = tickBetweenOpens(started);
  const reads = await screens.warm(tick.pause);
  const saved = await phase.backup(started.core);

  log("backed up");

  // The backup's pages, flushed now, count before the window, not in it.
  await run(["sync"]);

  const restoring = (): Promise<Ran> =>
    alongside({ ...of, name: `${of.name}-index`, data: restored });

  const { writes, done: others } = await phase.writesWhile(started.group, restoring);
  const peaks = await memory.stop();

  log(`core log:\n${await coreLog(started.id, 8)}`);
  await run(["docker", "rm", "-f", started.id]);

  const rows: Row[] = [
    {
      measurement: "startup, stopped container to first answer",
      budget: BUDGETS.startup,
      result: started.startup,
    },
    ...reads,
    await tick.row(),
    saved,
    { measurement: "file size", budget: null, result: await store.sizeOf(of.data), unit: "bytes" },
    writes,
    ...others.rows,
  ];

  return { rows, peaks: higher(peaks, others.peaks) };
}

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
async function measure(cache: string, image: string, name: string, work: string): Promise<Row[]> {
  const where = await dirs(work);
  const file = await store.copy(cache, where.data);
  const held = store.inspect(file);

  await Promise.all(held.ports.map((port) => store.unreachable(port)));
  store.trim(file, held.horizon);
  await store.evict(file);
  log(`schema ${held.version}, data to ${new Date(held.end).toISOString()}`);

  const of = { image, name, data: where.data, share: where.share };
  const ran = await measureCore(of, held, where.restored);

  return [
    ...ran.rows,
    ...memoryRows(ran.peaks),
    ...phase.UNMEASURED,
    phase.migration(held, await store.currentSchema()),
  ];
}

async function main(): Promise<number> {
  const began = performance.now();
  // Before the image: building the SPA invalidates the generator's build, which `--key` needs.
  const cache = await store.cachedFile();
  const image = await store.buildImage();
  const name = `sunreye-bench-${process.pid}`;
  const work = await mkdtemp(join(ROOT, "target", "bench", "run-"));

  const cleanUp = async (): Promise<void> => {
    await run(["docker", "rm", "-f", name, `${name}-index`]).catch(() => "");

    // A clean commit's image is kept for the next run on it.
    if (!image.reusable) await run(["docker", "image", "rm", image.tag]).catch(() => "");
    await rm(work, { recursive: true, force: true });
  };

  // An interrupted run would leave its containers and copies of the whole file behind.
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void cleanUp().finally(() => process.exit(130));
    });

  try {
    const { lines, breaches } = table(await measure(cache, image.tag, name, work));
    const seconds = ((performance.now() - began) / 1000).toFixed(0);

    process.stdout.write(`${lines.join("\n")}\n`);
    log(`${breaches === 0 ? "every budget kept" : `${breaches} breached`} in ${seconds} s`);

    return breaches === 0 ? 0 : 1;
  } finally {
    await cleanUp();
  }
}

process.exitCode = await main();
