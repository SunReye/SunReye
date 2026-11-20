// fallow-ignore-file coverage-gaps -- reads a live container's cgroup; run by hand with `bun run bench`.
// The benchmark container as the host sees it (ADR 24). The image is `FROM scratch`, so nothing
// runs inside it: every figure comes from the cgroup and `/proc` on the host.

import { readFile } from "node:fs/promises";

import { run } from "../smoke.ts";
import { cpu, type Cpu, inUse, written } from "./report.ts";

/** Hosts the core reaches on its own: weather, archive weather, spot prices, the profile index. */
const OUTBOUND = [
  "api.open-meteo.com",
  "archive-api.open-meteo.com",
  "api.energy-charts.info",
  "sunreye.github.io",
];

/** `docker run` flags for the core and a restore: the ADR's limits, and no way off the machine. */
export function confined(name: string): string[] {
  const user = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;

  return [
    "--name",
    name,
    "--memory",
    "64m",
    "--memory-swap",
    "64m",
    "--cpus",
    "0.5",
    // Bridged networks fail on this LXC host.
    "--network",
    "host",
    "--user",
    user,
    ...OUTBOUND.flatMap((host) => ["--add-host", `${host}:127.0.0.1`]),
  ];
}

export interface Container {
  readonly image: string;
  readonly name: string;
  /** Host directories mounted at `/data` and `/share`. */
  readonly data: string;
  readonly share: string;
  readonly listen: string;
}

/** Creates the core's container, stopped; its id. */
export function create(container: Container): Promise<string> {
  return run([
    "docker",
    "create",
    ...confined(container.name),
    "-v",
    `${container.data}:/data`,
    "-v",
    `${container.share}:/share`,
    "-e",
    `SUNREYE_LISTEN=${container.listen}`,
    "-e",
    "SUNREYE_DATA_DIR=/data",
    container.image,
  ]);
}

/** A running container's cgroup directory and main process. */
export interface Cgroup {
  readonly dir: string;
  readonly pid: number;
}

export async function cgroup(id: string): Promise<Cgroup> {
  const pid = Number(await run(["docker", "inspect", "-f", "{{.State.Pid}}", id]));
  const line = await readFile(`/proc/${pid}/cgroup`, "utf8");

  return { dir: `/sys/fs/cgroup${line.trim().split(":")[2] ?? ""}`, pid };
}

const read = (group: Cgroup, file: string): Promise<string> =>
  readFile(`${group.dir}/${file}`, "utf8");

export async function cpuNow(group: Cgroup): Promise<Cpu> {
  return cpu(await read(group, "cpu.stat"));
}

export async function writtenNow(group: Cgroup): Promise<number> {
  return written(await read(group, "io.stat"));
}

/** The process's peak resident set in bytes: exact, where the cgroup is only sampled. */
async function peakResident(group: Cgroup): Promise<number> {
  const status = await readFile(`/proc/${group.pid}/status`, "utf8");

  return Number(/VmHWM:\s+(\d+) kB/u.exec(status)?.[1] ?? Number.NaN) * 1024;
}

/** How often the cgroup reached its limit, and whether it was OOM-killed. */
async function memoryEvents(group: Cgroup): Promise<string> {
  return (await read(group, "memory.events")).trim().replaceAll("\n", ", ");
}

export interface Peaks {
  /** `memory.current` less the inactive file cache, sampled. */
  readonly workingSet: number;
  /** Anonymous memory, sampled. */
  readonly anon: number;
  /** `VmHWM`. */
  readonly resident: number;
}

/** The higher of two runs' peaks, each figure on its own. */
export function higher(a: Peaks, b: Peaks): Peaks {
  return {
    workingSet: Math.max(a.workingSet, b.workingSet),
    anon: Math.max(a.anon, b.anon),
    resident: Math.max(a.resident, b.resident),
  };
}

/** The core's own log lines, its refused device polls left out; the last `count`. */
export async function coreLog(id: string, count: number): Promise<string> {
  const logs = Bun.spawn(["docker", "logs", id], { stdout: "pipe", stderr: "pipe" });

  const [out, err] = await Promise.all([
    new Response(logs.stdout).text(),
    new Response(logs.stderr).text(),
  ]);

  const lines = `${out}${err}`
    .split("\n")
    .filter((line) => line !== "" && !/not read:|mqtt: I\/O/u.test(line));

  return lines.slice(-count).join("\n");
}

export interface Sampler {
  readonly stop: () => Promise<Peaks>;
}

/**
 * Samples memory in use every 50 ms until stopped: kernel 5.15 has no `memory.peak`, and
 * `memory.current` sits near the limit on the file's page cache alone.
 */
export function sampleMemory(group: Cgroup): Sampler {
  let running = true;
  const peaks = { workingSet: 0, anon: 0 };

  const loop = async (): Promise<void> => {
    if (!running) return;

    const files = await Promise.all([read(group, "memory.current"), read(group, "memory.stat")]);
    const now = inUse(...files);

    peaks.workingSet = Math.max(peaks.workingSet, now.workingSet);
    peaks.anon = Math.max(peaks.anon, now.anon);
    await Bun.sleep(50);

    return loop();
  };

  // A container that stopped has no cgroup left to read.
  const done = loop().catch(() => null);

  return {
    stop: async () => {
      const resident = await peakResident(group);

      running = false;
      await done;
      process.stderr.write(`bench: memory.events: ${await memoryEvents(group)}\n`);

      return { ...peaks, resident };
    },
  };
}
