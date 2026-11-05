/**
 * Oracle group 7: the learned forecast correction.
 *
 * 3.x `learn`, `correctionFactor` and `skillImprovementPct` over fixed observation sets. Observations are
 * computed here from fixed rules and recorded in `input`; nothing reads a clock.
 */
import type {
  CorrectionCell,
  CorrectionModel,
  Observation,
  SkillStats,
} from "../../apps/server/src/forecast/forecast-correction";

import { type CorpusFiles, ndjson } from "./corpus";

/** `month:hour` to cell, the model as recorded. */
type Cells = Record<string, CorrectionCell>;

interface LearnCase {
  case: string;
  producer: "learn";
  input: {
    model: Cells;
    skill: SkillStats;
    observations: Observation[];
    nameplateW: number;
    exportCapW?: number;
  };
}

interface FactorCase {
  case: string;
  producer: "correctionFactor";
  input: { model: Cells; month: number; hour: number };
}

interface SkillCase {
  case: string;
  producer: "skillImprovementPct";
  input: { skill: SkillStats };
}

const NO_SKILL: SkillStats = { maeRaw: 0, maeCorrected: 0, samples: 0 };
/** 10 kWp: dim below 300 W, curtailed from 8500 W. */
const NAMEPLATE_W = 10_000;

const pad = (n: number): string => String(n).padStart(2, "0");
const at = (year: number, month: number, day: number, hour: number): string =>
  `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:00`;

/** The same hour on `days` consecutive days from the first of `month`, at a fixed ratio. */
function stream(
  year: number,
  month: number,
  hour: number,
  ratio: number,
  days: number,
  expectedW = 5000,
): Observation[] {
  return Array.from({ length: days }, (_, d) => {
    const date = new Date(Date.UTC(year, month - 1, d + 1));
    return {
      localTime: at(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour),
      expectedW,
      actualW: expectedW * ratio,
    };
  });
}

/** One July day, 05:00–21:00: a bell peaking at 9000 W expected, the plant at `ratio` with a wobble. */
function day(ratio: (hour: number) => number): Observation[] {
  const out: Observation[] = [];
  for (let hour = 5; hour <= 21; hour++) {
    const expectedW = Math.round(9000 * Math.sin((Math.PI * (hour - 4)) / 18) * 10) / 10;
    out.push({
      localTime: at(2026, 7, 24, hour),
      expectedW,
      actualW: Math.round(expectedW * ratio(hour) * 10) / 10,
    });
  }
  return out;
}

const learnCase = (name: string, input: Partial<LearnCase["input"]>): LearnCase => ({
  case: `learn/${name}`,
  producer: "learn",
  input: { model: {}, skill: NO_SKILL, observations: [], nameplateW: NAMEPLATE_W, ...input },
});

const LEARN: LearnCase[] = [
  learnCase("empty", {}),
  learnCase("one-day", { observations: day((hour) => 0.85 + (hour % 3) * 0.05) }),
  learnCase("shrinkage-toward-one", { observations: stream(2026, 7, 13, 1.4, 1) }),
  learnCase("clamp-high", { observations: stream(2026, 7, 13, 5, 31, 1000) }),
  learnCase("clamp-low", { observations: stream(2026, 7, 13, 0.01, 31) }),
  learnCase("half-life-decay", {
    observations: [
      ...stream(2025, 6, 12, 0.7, 30),
      ...stream(2025, 7, 12, 0.7, 31),
      ...stream(2026, 6, 12, 1.1, 30),
      ...stream(2026, 7, 12, 1.1, 10),
    ],
  }),
  learnCase("skill-zero-error", { observations: day(() => 1) }),
  learnCase("zero-production-day", { observations: day(() => 0) }),
  learnCase("dim-negative-and-curtailed-skipped", {
    observations: [
      { localTime: at(2026, 3, 10, 7), expectedW: 299.9, actualW: 250 },
      { localTime: at(2026, 3, 10, 8), expectedW: 300, actualW: 240 },
      { localTime: at(2026, 3, 10, 9), expectedW: 0, actualW: 0 },
      { localTime: at(2026, 3, 10, 10), expectedW: -20, actualW: 10 },
      { localTime: at(2026, 3, 10, 11), expectedW: 4000, actualW: -1 },
      { localTime: at(2026, 3, 10, 12), expectedW: 4000, actualW: 0 },
      { localTime: at(2026, 3, 10, 13), expectedW: 8500, actualW: 7000 },
      { localTime: at(2026, 3, 10, 14), expectedW: 7000, actualW: 8500 },
      { localTime: at(2026, 3, 10, 15), expectedW: 8499.9, actualW: 8499.9 },
    ],
  }),
  learnCase("export-cap", {
    exportCapW: 5000,
    observations: [
      { localTime: at(2026, 5, 2, 10), expectedW: 4999, actualW: 4200 },
      { localTime: at(2026, 5, 2, 11), expectedW: 5000, actualW: 4990 },
      { localTime: at(2026, 5, 2, 12), expectedW: 6000, actualW: 4800 },
      { localTime: at(2026, 5, 2, 13), expectedW: 4800, actualW: 5000 },
    ],
  }),
  learnCase("export-cap-above-saturation", {
    exportCapW: 9500,
    observations: [
      { localTime: at(2026, 5, 2, 12), expectedW: 8600, actualW: 7000 },
      { localTime: at(2026, 5, 2, 13), expectedW: 8000, actualW: 7000 },
    ],
  }),
  learnCase("no-nameplate", { nameplateW: 0, observations: stream(2026, 7, 13, 0.9, 3) }),
  learnCase("prior-model-out-of-sample-skill", {
    model: { "7:13": { ratio: 0.8, weight: 20 }, "7:14": { ratio: 1.2, weight: 4 } },
    skill: { maeRaw: 600, maeCorrected: 450, samples: 18 },
    observations: [
      ...stream(2026, 7, 13, 0.82, 2),
      ...stream(2026, 7, 14, 1.25, 2),
      ...stream(2026, 7, 15, 0.95, 1),
    ],
  }),
  learnCase("dst-autumn-repeated-hour", {
    observations: [
      { localTime: "2025-10-26T01:00", expectedW: 400, actualW: 380 },
      { localTime: "2025-10-26T02:00", expectedW: 500, actualW: 450 },
      { localTime: "2025-10-26T02:00", expectedW: 520, actualW: 500 },
      { localTime: "2025-10-26T03:00", expectedW: 600, actualW: 560 },
    ],
  }),
  learnCase("dst-spring-missing-hour", {
    observations: [
      { localTime: "2026-03-29T01:00", expectedW: 400, actualW: 380 },
      { localTime: "2026-03-29T03:00", expectedW: 600, actualW: 560 },
    ],
  }),
];

const factorCase = (name: string, model: Cells, month = 7, hour = 13): FactorCase => ({
  case: `factor/${name}`,
  producer: "correctionFactor",
  input: { model, month, hour },
});

const FACTOR: FactorCase[] = [
  factorCase("unlearned-cell", { "7:12": { ratio: 1.3, weight: 10 } }),
  factorCase("zero-weight", { "7:13": { ratio: 2, weight: 0 } }),
  factorCase("shrunk", { "7:13": { ratio: 1.3, weight: 5 } }),
  factorCase("at-upper-bound", { "7:13": { ratio: 1.48, weight: 25 } }),
  factorCase("above-upper-bound", { "7:13": { ratio: 2.5, weight: 30 } }),
  factorCase("at-lower-bound", { "7:13": { ratio: 0.52, weight: 25 } }),
  factorCase("below-lower-bound", { "7:13": { ratio: 0.2, weight: 30 } }),
  factorCase("december-midnight", { "12:0": { ratio: 0.9, weight: 7 } }, 12, 0),
];

const skillCase = (name: string, skill: SkillStats): SkillCase => ({
  case: `skill/${name}`,
  producer: "skillImprovementPct",
  input: { skill },
});

const SKILL: SkillCase[] = [
  skillCase("no-samples", { maeRaw: 400, maeCorrected: 300, samples: 0 }),
  skillCase("zero-error", { maeRaw: 0, maeCorrected: 0, samples: 12 }),
  skillCase("improved", { maeRaw: 400, maeCorrected: 300, samples: 12 }),
  skillCase("worse", { maeRaw: 300, maeCorrected: 360, samples: 3.5 }),
  skillCase("perfect", { maeRaw: 250, maeCorrected: 0, samples: 30 }),
];

const modelOf = (cells: Cells): CorrectionModel =>
  new Map(Object.entries(cells).map(([key, cell]) => [key, { ...cell }]));

/** Cells in month, hour order. */
function cellsOf(model: CorrectionModel): Cells {
  const order = (key: string) => key.split(":").map(Number) as [number, number];
  const keys = [...model.keys()].sort((a, b) => {
    const [am, ah] = order(a);
    const [bm, bh] = order(b);
    return am - bm || ah - bh;
  });
  return Object.fromEntries(keys.map((key) => [key, model.get(key)!]));
}

/** Every case, its recorded output beside the input it was produced from. */
export async function buildForecastCorrectionCorpus(): Promise<CorpusFiles> {
  const { correctionFactor, learn, skillImprovementPct } =
    await import("../../apps/server/src/forecast/forecast-correction");

  const rows: unknown[] = [];
  for (const c of LEARN) {
    const { model, skill, observations, nameplateW, exportCapW } = c.input;
    const learned = modelOf(model);
    const result = learn(learned, skill, observations, nameplateW, exportCapW);
    const cells = cellsOf(learned);
    rows.push({
      ...c,
      output: {
        model: cells,
        touched: Object.keys(cells).filter((key) => result.touched.has(key)),
        skill: result.skill,
        improvementPct: skillImprovementPct(result.skill),
        factors: Object.fromEntries(
          Object.keys(cells).map((key) => {
            const [month, hour] = key.split(":").map(Number) as [number, number];
            return [key, correctionFactor(learned, month, hour)];
          }),
        ),
      },
    });
  }
  for (const c of FACTOR) {
    const { model, month, hour } = c.input;
    rows.push({ ...c, output: { factor: correctionFactor(modelOf(model), month, hour) } });
  }
  for (const c of SKILL) {
    rows.push({ ...c, output: { pct: skillImprovementPct(c.input.skill) } });
  }
  return { "forecast-correction.ndjson": ndjson(rows) };
}
