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
 *
 * Applying them (`applyStringCorrection`): an array wired to a string takes its string's cell where learned,
 * else the inverter's; every other array takes the inverter's. Each array is modelled alone through 3.x
 * `buildSolarForecast` with that merged grid, and the arrays' raw series are summed slot by slot.
 */
import type {
  CorrectionCell,
  CorrectionModel,
} from "../../apps/server/src/forecast/forecast-correction";
import type {
  IrradianceForecast,
  buildSolarForecast as BuildSolarForecast,
} from "../../apps/server/src/forecast/solar-forecast";

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

type ForecastConfig = Parameters<typeof BuildSolarForecast>[0];
type PvArray = ForecastConfig["arrays"][number];

interface ApplyCase {
  case: string;
  producer: "applyStringCorrection";
  input: {
    config: ForecastConfig;
    data: IrradianceForecast;
    timeZone: string;
    /** The inverter's grid. */
    correction?: Cells;
    /** Each array's string grid by position in `config.arrays`; `null` for an array without one. */
    arrayCorrections: Array<Cells | null>;
  };
}

const forecastConfig = (arrays: PvArray[]): ForecastConfig => ({
  enabled: true,
  provider: "open-meteo",
  arrays,
  tempCoefficient: -0.4,
  systemLoss: 14,
  maxOutputW: null,
  battery: null,
  houseLoadW: null,
  smartMeterSince: null,
  correction: { enabled: false },
});

const SOUTH: PvArray = { kwp: 5, tilt: 30, azimuth: 0 };
const EAST: PvArray = { kwp: 4, tilt: 35, azimuth: -80 };
const WEST: PvArray = { kwp: 2.4, tilt: 35, azimuth: 80 };

/** Hourly plant-local labels from `firstHour` on 2026-07-24, one plane per `gti` row. */
function hourly(
  firstHour: number,
  gti: number[][],
  place: { utcOffsetSeconds: number; latitude: number; longitude: number },
): IrradianceForecast {
  const count = gti[0]?.length ?? 0;
  return {
    times: Array.from({ length: count }, (_, i) => at(7, 24, firstHour + i)),
    utcOffsetSeconds: place.utcOffsetSeconds,
    location: { latitude: place.latitude, longitude: place.longitude },
    temperature: Array.from({ length: count }, () => 25),
    gti,
  };
}

const BERLIN = { utcOffsetSeconds: 7200, latitude: 50.39, longitude: 8.06 };
const KOLKATA = { utcOffsetSeconds: 19_800, latitude: 22.57, longitude: 88.36 };
/** 11:00 to 14:00 Berlin. */
const NOON = [600, 680, 720, 690];

const cell = (ratio: number): CorrectionCell => ({ ratio, weight: 30 });
const grid = (ratio: number, hours: number[]): Cells =>
  Object.fromEntries(hours.map((h) => [`7:${h}`, cell(ratio)]));

const applyCase = (
  name: string,
  input: Omit<ApplyCase["input"], "timeZone"> & { timeZone?: string },
): ApplyCase => ({
  case: `apply/${name}`,
  producer: "applyStringCorrection",
  input: { timeZone: "Europe/Berlin", ...input },
});

const APPLY_CASES: ApplyCase[] = [
  applyCase("string-over-total", {
    config: forecastConfig([SOUTH]),
    data: hourly(11, [NOON], BERLIN),
    correction: grid(0.8, [12, 13]),
    arrayCorrections: [grid(1.3, [12, 13])],
  }),
  applyCase("two-arrays", {
    config: forecastConfig([EAST, WEST]),
    data: hourly(
      11,
      [
        [700, 620, 480, 330],
        [380, 520, 650, 720],
      ],
      BERLIN,
    ),
    correction: grid(0.8, [11, 12, 13, 14]),
    arrayCorrections: [grid(1.3, [11, 12, 13, 14]), null],
  }),
  applyCase("fallback-to-inverter", {
    config: forecastConfig([SOUTH]),
    data: hourly(11, [NOON], BERLIN),
    correction: grid(0.8, [11, 12, 13, 14]),
    arrayCorrections: [grid(1.3, [12])],
  }),
  applyCase("string-without-inverter-grid", {
    config: forecastConfig([EAST, WEST]),
    data: hourly(
      11,
      [
        [700, 620, 480, 330],
        [380, 520, 650, 720],
      ],
      BERLIN,
    ),
    arrayCorrections: [grid(1.3, [12, 13]), null],
  }),
  // Labels are Kolkata wall clock (+05:30): the cells at UTC hours 5 and 6 match no label.
  applyCase("plant-zone", {
    config: forecastConfig([SOUTH]),
    data: hourly(10, [NOON], KOLKATA),
    timeZone: "Asia/Kolkata",
    correction: { ...grid(0.8, [12]), ...grid(1.4, [6]) },
    arrayCorrections: [{ ...grid(1.3, [11]), ...grid(0.6, [5]) }],
  }),
];

type Build = typeof BuildSolarForecast;

/** The reference rule: each array alone under its string's cells over the inverter's, the raw series summed. */
function applyStringCorrection(build: Build, input: ApplyCase["input"]) {
  const perArray = input.config.arrays.map((array, a) => {
    const cells = { ...input.correction, ...input.arrayCorrections[a] };
    const correction = Object.keys(cells).length > 0 ? modelOf(cells) : undefined;
    const data = { ...input.data, gti: [input.data.gti[a] ?? []] };
    const config = { ...input.config, arrays: [array] };
    return build(config, data, "open-meteo", input.timeZone, 0, undefined, correction).raw.series;
  });
  const first = perArray[0] ?? [];
  return first.map((point, i) => ({
    time: point.time,
    watts: perArray.reduce((sum, series) => sum + (series[i]?.watts ?? 0), 0),
  }));
}

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
  const { buildSolarForecast } = await import("../../apps/server/src/forecast/solar-forecast");
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
  const applied = APPLY_CASES.map((c) => ({
    ...c,
    output: { series: applyStringCorrection(buildSolarForecast, c.input) },
  }));
  return { "forecast-string-correction.ndjson": ndjson([...rows, ...applied]) };
}

export const oracle: OracleGenerator = {
  files: ["forecast-string-correction.ndjson"],
  build: buildStringCorrectionCorpus,
};
