// The installer's view (ADR 17, 21): strings compared by specific yield and by measured over
// modelled, and the correction each MPPT input learned per month and hour. Pure.
import type { Corrections, PvString } from "../api/core.ts";

/** One MPPT input's learned correction, as the core serves it. */
export interface InputCorrection {
  readonly device: number;
  readonly input: number;
  readonly factors: readonly Readonly<Corrections["inputs"][number]["factors"][number]>[];
  readonly recent?: Readonly<NonNullable<Corrections["inputs"][number]["recent"]>> | null;
}

export interface StringRow {
  readonly id: number;
  readonly name: string;
  readonly device: number;
  readonly input: number;
  readonly kwp: number;
  /** In the range; null before it is read. */
  readonly kwh: number | null;
  /** Specific yield, the fair comparison between strings of different size. */
  readonly perKwp: number | null;
  /** Its input's measured over modelled in the last 30 days; null without a model. */
  readonly ratio: number | null;
  /** Shares its MPPT input, so its power is split by modelled current, not measured. */
  readonly estimated: boolean;
  /** Morning over afternoon correction, halved: far from zero means a wrong azimuth. */
  readonly skew: number;
  /** `weak`: clearly under its model lately; `face`: its day is skewed against its azimuth. */
  readonly flag: "weak" | "face" | null;
}

export interface StringFigures {
  /** A module type's watts at standard test conditions. */
  readonly pmax: (moduleType: number) => number | undefined;
  /** A string's energy in the range, by its id; null before it is read. */
  readonly kwh: (id: number) => number | null;
  readonly corrections: readonly InputCorrection[];
}

/** `[month][hour]`; null where nothing is known. */
export type Grid = (number | null)[][];

type Cells = readonly (readonly (number | null)[])[];

const WEAK = 0.92;
const SKEWED = 0.06;

/** The input's learned factors, `[month 0–11][hour]`; an unlearned cell is null. */
export function correctionGrid(c: InputCorrection | null | undefined): Grid {
  const grid = Array.from({ length: 12 }, () =>
    Array.from({ length: 24 }, (): number | null => null),
  );

  for (const f of c?.factors ?? []) grid[f.month - 1]![f.hour] = f.factor;

  return grid;
}

function mean(grid: Cells, from: number, to: number): number | null {
  const all = grid.flatMap((col) => col.slice(from, to).filter((v) => v !== null));

  return all.length === 0 ? null : all.reduce((a, b) => a + b, 0) / all.length;
}

function skewOf(grid: Cells): number {
  const [am, pm] = [mean(grid, 8, 12), mean(grid, 14, 18)];

  return am === null || pm === null ? 0 : (am - pm) / 2;
}

/** Measured over modelled in the input's last 30 days; null without a model. */
function ratioOf(c: InputCorrection | undefined): number | null {
  const recent = c?.recent;

  return recent && recent.modelled > 0 ? recent.measured / recent.modelled : null;
}

function flagOf(ratio: number | null, skew: number): StringRow["flag"] {
  if (ratio !== null && ratio < WEAK) return "weak";

  return Math.abs(skew) > SKEWED ? "face" : null;
}

const perKwp = (kwh: number | null, kwp: number) => (kwh === null || kwp <= 0 ? null : kwh / kwp);

/** The layout's strings as the comparison lists them. */
export function stringRows(
  strings: readonly Readonly<PvString>[],
  figures: Readonly<StringFigures>,
): StringRow[] {
  const shared = (s: Readonly<PvString>) =>
    strings.some(
      (o: Readonly<PvString>) => o.id !== s.id && o.device === s.device && o.input === s.input,
    );

  return strings.map((s: Readonly<PvString>) => {
    const kwp = (s.modules * (figures.pmax(s.moduleType) ?? 0)) / 1000;
    const kwh = figures.kwh(s.id);

    const c = figures.corrections.find(
      (i: InputCorrection) => i.device === s.device && i.input === s.input,
    );

    const [ratio, skew] = [ratioOf(c), skewOf(correctionGrid(c))];

    return {
      id: s.id,
      name: s.name,
      device: s.device,
      input: s.input,
      kwp,
      kwh,
      perKwp: perKwp(kwh, kwp),
      ratio,
      estimated: shared(s),
      skew,
      flag: flagOf(ratio, skew),
    };
  });
}
