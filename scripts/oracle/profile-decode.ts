// fallow-ignore-file unused-export unused-type private-type-leak -- the corpus format is exported for the tests and the Rust port that read it; test files are not traced as consumers
/**
 * Oracle group 2 — profile decode.
 *
 * For each official profile: the register runs a poll would read (the 2.x read plan), a handful of
 * register patterns, and the readings the 2.x codec and computed metrics make of them. Each line
 * carries the metric definitions it decoded with, so the line can be replayed without the profile
 * repository; `sha256` ties it to the profile file it came from.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  applyComputed,
  clampReports,
  compileComputeExpr,
  decode,
  hydrateProfile,
  parseProfileData,
  planReads,
  resetClampReports,
  type ComputeExpr,
  type MetricDef,
  type RegisterType,
} from "@SunReye/inverter-core";

import { type CorpusFiles, ndjson } from "./corpus";

/** A metric as the decode needs it: a register binding or a compute expression. */
export interface SlimMetric {
  key: string;
  via: "modbus" | "compute";
  type: RegisterType;
  addr: number[];
  scale: number;
  offset?: number;
  range?: { min: number; max: number };
  expr?: ComputeExpr;
}

interface Run {
  start: number;
  words: number[];
}

export interface ProfileDecodeCase {
  profile: { id: string; name: string; manufacturer: string; version: string; sha256: string };
  metrics: SlimMetric[];
  blocks: { start: number; count: number }[];
  cases: {
    name: string;
    runs: Run[];
    readings: Record<string, number>;
    clamped: Record<string, number>;
  }[];
}

type Registers = Record<number, number>;

// ---------------------------------------------------------------------------
// Decoding

const defOf = (m: SlimMetric): MetricDef =>
  ({
    key: m.key,
    scale: m.scale,
    ...(m.offset === undefined ? {} : { offset: m.offset }),
    ...(m.range === undefined ? {} : { range: m.range }),
    binding:
      m.via === "compute"
        ? { via: "compute", expr: m.expr }
        : { via: "modbus", addr: m.addr, type: m.type },
    ...(m.expr ? { compute: compileComputeExpr(m.expr) } : {}),
  }) as unknown as MetricDef;

/** What the 2.x codec reads out of `regs`, then what the computed metrics make of it. */
export function decodeReadings(
  metrics: readonly SlimMetric[],
  regs: Registers,
): { readings: Record<string, number>; clamped: Record<string, number> } {
  const words = new Map(Object.entries(regs).map(([addr, word]) => [Number(addr), word]));
  const defs = metrics.map(defOf);
  resetClampReports();
  const readings: Record<string, number> = {};
  for (const def of defs) {
    if (def.binding.via !== "modbus") continue;
    const value = decode(def, words);
    if (value !== undefined) readings[def.key] = value;
  }
  applyComputed(defs, readings);
  const clamped = Object.fromEntries(clampReports().map((c) => [c.key, c.lastValue]));
  return { readings, clamped };
}

// ---------------------------------------------------------------------------
// Where the profiles are

interface IndexEntry {
  id: string;
  name: string;
  manufacturer: string;
  version: string;
  path: string;
}

interface LoadedProfile {
  entry: IndexEntry;
  sha256: string;
  data: ReturnType<typeof parseProfileData>;
}

/**
 * The profile repository checkout: `SUNREYE_PROFILES_DIR`, else `SunReye-Official-Profiles` beside
 * the main checkout. Null when neither holds an `index.json`.
 */
export function officialProfilesDir(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const candidate = env.SUNREYE_PROFILES_DIR ?? siblingOfMainCheckout();
  return candidate !== null && existsSync(join(candidate, "index.json")) ? candidate : null;
}

function siblingOfMainCheckout(): string | null {
  const git = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: import.meta.dir,
  });
  if (git.exitCode !== 0) return null;
  return resolve(git.stdout.toString().trim(), "..", "..", "SunReye-Official-Profiles");
}

/** Every indexed profile, ordered by id. */
export async function loadProfiles(dir: string): Promise<LoadedProfile[]> {
  const index = JSON.parse(await readFile(join(dir, "index.json"), "utf8")) as {
    profiles: IndexEntry[];
  };
  const loaded: LoadedProfile[] = [];
  for (const entry of index.profiles) {
    const bytes = await readFile(join(dir, entry.path));
    loaded.push({
      entry,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      data: parseProfileData(JSON.parse(bytes.toString("utf8"))),
    });
  }
  return loaded.sort((a, b) => (a.entry.id < b.entry.id ? -1 : 1));
}

// ---------------------------------------------------------------------------
// The corpus

const PATTERNS: Record<string, (addr: number) => number> = {
  zeros: () => 0,
  ramp: (addr) => (addr * 7 + 13) % 3000,
  "all-ones": () => 0xffff,
  "sign-bit": (addr) => 0x8000 | (addr & 0xff),
};

function slimOf(def: MetricDef): SlimMetric | null {
  const b = def.binding;
  const common = {
    key: def.key,
    scale: def.scale,
    ...(def.offset === undefined ? {} : { offset: def.offset }),
    ...(def.range === undefined ? {} : { range: def.range }),
  };
  if (b.via === "compute")
    return { ...common, via: "compute", type: "U_WORD", addr: [], expr: b.expr };
  if (b.via === "modbus" && b.type !== "RAW")
    return { ...common, via: "modbus", type: b.type, addr: b.addr };
  return null;
}

/** Contiguous runs of the addresses a block still holds. */
function runsOf(
  blocks: { start: number; count: number }[],
  pattern: (a: number) => number,
  omit: Set<number>,
): Run[] {
  const runs: Run[] = [];
  for (const block of blocks) {
    let current: Run | null = null;
    for (let a = block.start; a < block.start + block.count; a++) {
      if (omit.has(a)) {
        current = null;
        continue;
      }
      if (current === null) runs.push((current = { start: a, words: [] }));
      current.words.push(pattern(a));
    }
  }
  return runs;
}

function scenarios(blocks: { start: number; count: number }[], metrics: SlimMetric[]) {
  const first = blocks[0]!;
  const dword = metrics.find((m) => m.via === "modbus" && m.type === "U_DWORD");
  const victim = dword?.addr[1] ?? first.start;
  return [
    ...Object.entries(PATTERNS).map(([name, pattern]) => ({
      name,
      pattern,
      omit: new Set<number>(),
    })),
    {
      name: "first-block-absent",
      pattern: PATTERNS.ramp!,
      omit: new Set(Array.from({ length: first.count }, (_, i) => first.start + i)),
    },
    { name: "double-word-split", pattern: PATTERNS.ramp!, omit: new Set([victim]) },
  ];
}

function caseOf(loaded: LoadedProfile): ProfileDecodeCase {
  const profile = hydrateProfile(loaded.data);
  const blocks = planReads(profile.metrics, 0).map(({ start, count }) => ({ start, count }));
  const metrics = profile.metrics.flatMap((m) => slimOf(m) ?? []);
  const cases = scenarios(blocks, metrics).map(({ name, pattern, omit }) => {
    const runs = runsOf(blocks, pattern, omit);
    const regs: Registers = {};
    for (const run of runs) run.words.forEach((word, i) => (regs[run.start + i] = word));
    return { name, runs, ...decodeReadings(metrics, regs) };
  });
  const { id, name, manufacturer, version } = loaded.entry;
  return {
    profile: { id, name, manufacturer, version, sha256: loaded.sha256 },
    metrics,
    blocks,
    cases,
  };
}

/** Build `profile-decode.ndjson` from a profile repository checkout. */
export async function buildProfileDecodeCorpus(dir: string): Promise<CorpusFiles> {
  return { "profile-decode.ndjson": ndjson((await loadProfiles(dir)).map(caseOf)) };
}
