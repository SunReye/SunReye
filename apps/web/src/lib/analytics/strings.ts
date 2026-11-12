// The installer's view (ADR 17, 21): strings compared by specific yield and by measured over
// modelled, and the correction each MPPT input learned per month and hour. Pure.
import type { Corrections, PvString } from "../api/core.ts";

export type InputCorrection = Corrections["inputs"][number];

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
  /** Each module type's watts at standard test conditions. */
  readonly pmax: ReadonlyMap<number, number>;
  /** Each string's energy in the range, by string id. */
  readonly kwh: ReadonlyMap<number, number | null>;
  readonly corrections: readonly InputCorrection[];
}

const WEAK = 0.92;
const SKEWED = 0.06;

/** The input's learned factors, `[month 0–11][hour]`; an unlearned cell is null. */
export function correctionGrid(c: InputCorrection | undefined): (number | null)[][] {
  const grid = Array.from({ length: 12 }, () => Array<number | null>(24).fill(null));

  for (const f of c?.factors ?? []) grid[f.month - 1]![f.hour] = f.factor;

  return grid;
}

function mean(grid: readonly (number | null)[][], from: number, to: number): number | null {
  const all = grid.flatMap((col) => col.slice(from, to)).filter((v) => v !== null);

  return all.length === 0 ? null : all.reduce((a, b) => a + b, 0) / all.length;
}

function skewOf(grid: readonly (number | null)[][]): number {
  const [am, pm] = [mean(grid, 8, 12), mean(grid, 14, 18)];

  return am === null || pm === null ? 0 : (am - pm) / 2;
}

/** The layout's strings as the comparison lists them. */
export function stringRows(strings: readonly PvString[], figures: StringFigures): StringRow[] {
  return strings.map((s) => {
    const kwp = (s.modules * (figures.pmax.get(s.moduleType) ?? 0)) / 1000;
    const kwh = figures.kwh.get(s.id) ?? null;
    const c = figures.corrections.find((i) => i.device === s.device && i.input === s.input);
    const recent = c?.recent;
    const ratio = recent && recent.modelled > 0 ? recent.measured / recent.modelled : null;
    const skew = skewOf(correctionGrid(c));

    const flag = ratio !== null && ratio < WEAK ? "weak" : Math.abs(skew) > SKEWED ? "face" : null;

    return {
      id: s.id,
      name: s.name,
      device: s.device,
      input: s.input,
      kwp,
      kwh,
      perKwp: kwh === null || kwp <= 0 ? null : kwh / kwp,
      ratio,
      estimated: strings.some((o) => o.id !== s.id && o.device === s.device && o.input === s.input),
      skew,
      flag,
    };
  });
}
