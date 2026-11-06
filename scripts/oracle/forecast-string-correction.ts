/**
 * Oracle: the forecast correction learned per array from its MPPT string.
 *
 * 3.x has no MPPT logic, so the producer is the reference rule below, reviewed as the spec. It folds through
 * 3.x `learn` unchanged; the only addition is which hours a string may learn from:
 *
 * - expected is the array's own modelled output, actual the string's measured `pv.string.power`;
 * - the dim floor and the saturation ceiling are 3.x's, taken against the array's nameplate;
 * - an hour the inverter is likely curtailed in (3.x's ceiling against the inverter's nameplate and the
 *   feed-in cap, on its modelled and its measured total) is skipped: a curtailed inverter holds every string
 *   below its maximum power point, whatever the string's own share. A missing measured total is judged by
 *   the modelled total alone.
 *
 * No voltage rule: no recorded string voltage exists to derive one from (see `cases.d`).
 */
import type {
  CorrectionCell,
  CorrectionModel,
} from "../../apps/server/src/forecast/forecast-correction";

import { type CorpusFiles, ndjson } from "./corpus";
import type { OracleGenerator } from "./registry";

/** 3.x `SATURATION_FRAC` (not exported there). */
const SATURATION_FRAC = 0.85;

type Cells = Record<string, CorrectionCell>;

interface StringObservation {
  /** Plant-local `YYYY-MM-DDTHH:mm`. */
  localTime: string;
  /** The array's modelled average over the hour, W. */
  expectedW: number;
  /** The string's measured average, W. */
  actualW: number;
  /** The inverter's modelled total, W. */
  inverterExpectedW: number;
  /** The inverter's measured total, W; absent when no reading. */
  inverterActualW?: number;
}

interface StringCase {
  case: string;
  producer: "learnString";
  input: {
    model: Cells;
    observations: StringObservation[];
    arrayNameplateW: number;
    inverterNameplateW: number;
    exportCapW?: number;
  };
}

const ARRAY_W = 4000;
const INVERTER_W = 10_000;

const pad = (n: number): string => String(n).padStart(2, "0");
const at = (month: number, day: number, hour: number, year = 2026): string =>
  `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:00`;

/** One hour of a 4 kWp string beside a comfortable inverter total. */
const hour = (
  localTime: string,
  expectedW: number,
  actualW: number,
  inverter: Partial<Pick<StringObservation, "inverterExpectedW" | "inverterActualW">> = {},
): StringObservation => ({
  localTime,
  expectedW,
  actualW,
  inverterExpectedW: 5000,
  inverterActualW: 4800,
  ...inverter,
});

const stringCase = (name: string, input: Partial<StringCase["input"]>): StringCase => ({
  case: `string/${name}`,
  producer: "learnString",
  input: {
    model: {},
    observations: [],
    arrayNameplateW: ARRAY_W,
    inverterNameplateW: INVERTER_W,
    ...input,
  },
});

/** One July day 06:00–20:00: the string at 0.7 of its model while the total looks right. */
function shadedDay(): StringObservation[] {
  const out: StringObservation[] = [];
  for (let h = 6; h <= 20; h++) {
    const expectedW = Math.round(3200 * Math.sin((Math.PI * (h - 5)) / 16) * 10) / 10;
    out.push(hour(at(7, 24, h), expectedW, Math.round(expectedW * 0.7 * 10) / 10));
  }
  return out;
}

const CASES: StringCase[] = [
  stringCase("empty", {}),
  stringCase("shaded-string", { observations: shadedDay() }),
  stringCase("array-floor-and-ceiling", {
    observations: [
      hour(at(3, 10, 8), 119.9, 100),
      hour(at(3, 10, 9), 120, 90),
      hour(at(3, 10, 10), 3400, 3000),
      hour(at(3, 10, 11), 3000, 3400),
      hour(at(3, 10, 12), 3399.9, 3399.9),
    ],
  }),
  stringCase("night-zero", {
    observations: [
      hour(at(1, 5, 2), 0, 0, { inverterExpectedW: 0, inverterActualW: 0 }),
      hour(at(1, 5, 23), 0, 0, { inverterExpectedW: 0 }),
    ],
  }),
  stringCase("negative-string-power", {
    observations: [hour(at(5, 2, 10), 2000, -3), hour(at(5, 2, 11), 2000, 0)],
  }),
  stringCase("inverter-curtailed", {
    observations: [
      hour(at(6, 1, 11), 2000, 1500, { inverterActualW: 8500 }),
      hour(at(6, 1, 12), 2000, 1500, { inverterActualW: 8499.9 }),
      hour(at(6, 1, 13), 2000, 1500, { inverterExpectedW: 8500 }),
      hour(at(6, 1, 14), 2000, 1500, { inverterExpectedW: 8499.9 }),
    ],
  }),
  stringCase("inverter-total-missing", {
    observations: [
      hour(at(6, 2, 12), 2000, 1600, { inverterActualW: undefined }),
      hour(at(6, 2, 13), 2000, 1600, {
        inverterExpectedW: 9000,
        inverterActualW: undefined,
      }),
    ],
  }),
  stringCase("export-cap", {
    exportCapW: 5000,
    observations: [
      hour(at(5, 2, 10), 2000, 1800, {
        inverterExpectedW: 4999,
        inverterActualW: 4200,
      }),
      hour(at(5, 2, 11), 2000, 1800, {
        inverterExpectedW: 5000,
        inverterActualW: 4200,
      }),
      hour(at(5, 2, 12), 2000, 1800, {
        inverterExpectedW: 4800,
        inverterActualW: 5000,
      }),
    ],
  }),
  stringCase("export-cap-above-saturation", {
    exportCapW: 9500,
    observations: [
      hour(at(5, 3, 12), 2000, 1800, { inverterExpectedW: 8600 }),
      hour(at(5, 3, 13), 2000, 1800, { inverterExpectedW: 8000 }),
    ],
  }),
  stringCase("no-array-nameplate", {
    arrayNameplateW: 0,
    observations: [hour(at(7, 1, 13), 2000, 1800)],
  }),
  stringCase("prior-model", {
    model: { "7:13": { ratio: 0.8, weight: 20 } },
    observations: [hour(at(7, 1, 13), 2000, 1640), hour(at(7, 2, 13), 2000, 1700)],
  }),
  stringCase("dst-autumn-repeated-hour", {
    observations: [
      hour("2025-10-26T02:00", 500, 450),
      hour("2025-10-26T02:00", 520, 500),
      hour("2025-10-26T03:00", 600, 560),
    ],
  }),
  stringCase("dst-spring-missing-hour", {
    observations: [hour("2026-03-29T01:00", 400, 380), hour("2026-03-29T03:00", 600, 560)],
  }),
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

type Learn = typeof import("../../apps/server/src/forecast/forecast-correction").learn;

/** The reference rule: the inverter's curtailed hours out, the rest through 3.x `learn` on the array. */
function learnString(
  learn: Learn,
  model: CorrectionModel,
  input: StringCase["input"],
): Set<string> {
  const ceiling = Math.min(
    input.inverterNameplateW * SATURATION_FRAC,
    input.exportCapW ?? Number.POSITIVE_INFINITY,
  );
  const fit = input.observations.filter(
    (o) =>
      o.inverterExpectedW < ceiling &&
      !(o.inverterActualW !== undefined && o.inverterActualW >= ceiling),
  );
  const observations = fit.map(({ localTime, expectedW, actualW }) => ({
    localTime,
    expectedW,
    actualW,
  }));
  const none = { maeRaw: 0, maeCorrected: 0, samples: 0 };
  return learn(model, none, observations, input.arrayNameplateW).touched;
}

async function buildStringCorrectionCorpus(): Promise<CorpusFiles> {
  const { correctionFactor, learn } =
    await import("../../apps/server/src/forecast/forecast-correction");
  const rows = CASES.map((c) => {
    const learned = modelOf(c.input.model);
    const touched = learnString(learn, learned, c.input);
    const cells = cellsOf(learned);
    const factors = Object.keys(cells).map((key) => {
      const [month, hour] = key.split(":").map(Number) as [number, number];
      return [key, correctionFactor(learned, month, hour)];
    });
    return {
      ...c,
      output: {
        model: cells,
        touched: Object.keys(cells).filter((key) => touched.has(key)),
        factors: Object.fromEntries(factors),
      },
    };
  });
  return { "forecast-string-correction.ndjson": ndjson(rows) };
}

export const oracle: OracleGenerator = {
  files: ["forecast-string-correction.ndjson"],
  build: buildStringCorrectionCorpus,
};
