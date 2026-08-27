/**
 * Response bodies for everything `api-mock.ts` answers beyond the live socket
 * and the time series.
 *
 * Split out of `api-mock.ts` so that file stays a ROUTING table you can read in
 * one screen. Everything here is a payload, and every payload is copied from a
 * named contract rather than invented.
 *
 * ## The contract binding is a COMPILE GATE, not a comment
 *
 * Every fixture the wire has a type for is bound to that type — `satisfies` for
 * the constants, an explicit return type for the functions — and
 * `bun run e2e:types` is what checks it. This file used to only *name* the
 * contracts in prose, and three fixtures had drifted away from them without a
 * word: a `LogEntry` with `level: "warn"` (the union says `"warning"`), a
 * `DecisionPoint[]` invented field-for-field (`at`/`excessW`/`soc` against a
 * contract that says `t`/`pvW`/`socPct`, so the decision charts under it drew
 * ZERO rows), and a `SolarForecast` missing its required `raw`. All three were
 * one `satisfies` away from being impossible.
 *
 * The types are imported from `@SunReye/contracts/*`, which every `types.ts`
 * declares type-only — no runtime tail, no Postgres driver, nothing that could
 * reach a browser bundle. `@SunReye/db` is the package that must stay
 * unreachable, so the settings defaults below are still INLINED, each naming
 * the `default*` export it mirrors.
 *
 * Two shapes have no contract to bind to and are annotated by hand: the
 * `/api/weather` reading (typed in `apps/server`, mirrored by the web tile's
 * own `Weather`) and the hand-assembled server responses (`status`, `profiles`,
 * `apiKeys`), which are structural JSON the server builds inline.
 *
 * ## Why these numbers are not zeroes
 *
 * Half of the endpoints below may legally answer `null` or `[]` — weather off,
 * no price feed, no complete day of history yet — and the UI's response is to
 * render NOTHING. A fixture that takes the empty branch therefore produces a
 * page that looks fine and asserts nothing: the smoke case passes because the
 * section it was meant to check is absent. So every fixture here is the
 * populated case, with non-zero values.
 *
 * The empty branches still matter — `payloadOrNull` exists for them — and are
 * reachable through `BackendOptions` (`weather: null`, `prices: null`,
 * `evcc: null`), each one driven by a case in `e2e/payload-states.spec.ts`.
 *
 * ## Why nothing here is a date literal
 *
 * Every instant is derived from `Date.now()`. A fixture pinned to
 * `2026-08-18` is green on the day it was written and then decays with the
 * calendar rather than with the code — and the pages under test filter by
 * window ("today", "last 90 days", "this year"), so the decay is silent: the
 * section renders, empty.
 */

import type {
  AutomationStreamMessage,
  DecisionPoint,
  PeakShavingStatus,
} from "@SunReye/contracts/automation";
import type { CostBreakdown, PeriodEnergy } from "@SunReye/contracts/energy";
import type { EvccState } from "@SunReye/contracts/evcc";
import type { LogEntry } from "@SunReye/contracts/logs";
import type { PricedSlot, SpotPriceView, SpotStats } from "@SunReye/contracts/prices";
import type {
  ComparisonResponse,
  HeatmapCell,
  RecordsResponse,
  StatisticsTodayMessage,
} from "@SunReye/contracts/statistics";
// Type-only, and the only import that reaches into `src`: `/api/weather` has no
// contracts package entry (its types live in `apps/server/src/forecast`), and
// this is the shape the tile under test actually consumes.
import type { SolarForecast, Weather } from "../../src/lib/components/inverter/_shared/weather";
import type { FixtureManifest } from "./api-mock";

const DAY_MS = 86_400_000;

/** ISO instant `ms` milliseconds ago. */
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

/** `YYYY-MM-DD` for the UTC day `days` before today. */
const dayKey = (days: number): string =>
  new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);

// ─── Engine status ──────────────────────────────────────────────────────────

/** `GET /api/status` — `runtime.status()`, polled by every `/settings/*` route. */
export function status(manifest: FixtureManifest): {
  inverter: {
    connected: boolean;
    simulate: boolean;
    lastError: string | null;
    lastSampleAt: string;
    profile: string;
  };
  mqtt: { enabled: boolean; connected: boolean; lastError: string | null };
} {
  return {
    inverter: {
      connected: true,
      simulate: false,
      lastError: null,
      lastSampleAt: new Date().toISOString(),
      profile: manifest.id,
    },
    mqtt: { enabled: false, connected: false, lastError: null },
  };
}

// ─── Weather ────────────────────────────────────────────────────────────────

/**
 * The plant's UTC offset in the forecast fixture, seconds.
 *
 * Berlin in summer, to match {@link WEATHER_CONFIG}'s coordinates. The series'
 * `time` strings are MARKET/PLANT-LOCAL wall clock (`YYYY-MM-DDTHH:mm`), which
 * is what `solar-forecast-dialog.svelte` labels its axis with — a UTC string
 * here would silently shift every bar two hours.
 */
const PLANT_UTC_OFFSET_SECONDS = 7200;

/** The instant that starts the current local day at `offsetSeconds`. */
function localDayStartMs(offsetSeconds: number, dayOffset = 0): number {
  const shifted = Date.now() + offsetSeconds * 1000;
  return Math.floor(shifted / DAY_MS) * DAY_MS - offsetSeconds * 1000 + dayOffset * DAY_MS;
}

/** Local wall clock `YYYY-MM-DDTHH:mm` of an absolute instant at `offsetSeconds`. */
function localWallClock(atMs: number, offsetSeconds: number): string {
  return new Date(atMs + offsetSeconds * 1000).toISOString().slice(0, 16);
}

/**
 * A day of 15-minute PV slots, `scale`× a 3.6 kWp bell curve around local noon.
 *
 * A real Open-Meteo day is 96 slots wide — the two-point "hourly" series this
 * fixture used to carry was a combination the provider never emits, and
 * `stepMinutes: 15` beside it made the dialog compute 96 slots of which 2 filled.
 */
function forecastSlots(scale: number): { time: string; watts: number; peakWatts: number }[] {
  const dayStart = localDayStartMs(PLANT_UTC_OFFSET_SECONDS);
  return Array.from({ length: 96 }, (_, i) => {
    const at = dayStart + i * 15 * 60_000;
    // Zero before 05:00 and after 21:00 local, a smooth arc in between.
    const hour = i / 4;
    const daylight = Math.max(0, Math.sin(((hour - 5) / 16) * Math.PI));
    const watts = Math.round(3600 * scale * daylight ** 1.6);
    return {
      time: localWallClock(at, PLANT_UTC_OFFSET_SECONDS),
      watts,
      peakWatts: Math.round(watts * 1.12),
    };
  });
}

/**
 * `GET /api/weather` — a server `WeatherReading` spread with its forecast.
 *
 * Readable on purpose: `isReadableWeather()` (`inverter/_shared/weather.ts`)
 * renders nothing at all for a partial reading, so the tile is invisible unless
 * every field below is present.
 *
 * `raw` is required by the server's own `SolarForecast` and is what the detail
 * dialog's uncurtailed-potential overlay draws (`fillRaw` reads
 * `chartable.raw.series`); omitting it made that overlay permanently dead under
 * the mock. It is the same curve un-clipped, so it sits above the usable one.
 */
export const WEATHER = {
  temperature: 18.4,
  unit: "°C",
  code: 2,
  condition: "Partly cloudy",
  icon: "partly-cloudy",
  solarRadiationSum: 12.7,
  label: "Berlin",
  forecast: {
    provider: "open-meteo",
    stepMinutes: 15,
    utcOffsetSeconds: PLANT_UTC_OFFSET_SECONDS,
    series: forecastSlots(1),
    raw: { series: forecastSlots(1.18) },
    todayKwh: 21.4,
    remainingTodayKwh: 8.1,
    tomorrowKwh: 23.9,
    next15: { maxPowerW: 3600, avgPowerW: 3200, energyKwh: 0.8 },
  },
} satisfies Weather & {
  /** Fields the server always sends that the tile's own type does not read. */
  code: number;
  forecast: SolarForecast & { utcOffsetSeconds: number; raw: { series: SolarForecast["series"] } };
};

// ─── Energy & cost ──────────────────────────────────────────────────────────

/** `CostBreakdown` (`packages/contracts/src/energy/types.ts`) for `[from, to)`. */
export function costBreakdown(from: string, to: string, scale = 1): CostBreakdown {
  const round = (n: number) => Math.round(n * scale * 100) / 100;
  // The day the window STARTS in — a literal date here decays with the calendar
  // while every window the page picks keeps moving.
  const firstDay = new Date(Date.parse(from) || Date.now()).toISOString().slice(0, 10);
  return {
    currency: "EUR",
    from,
    to,
    importKwh: round(8.4),
    exportKwh: round(12.1),
    loadKwh: round(19.6),
    productionKwh: round(24.3),
    batteryDischargeKwh: round(4.2),
    batteryChargeKwh: round(5.1),
    importCost: round(2.52),
    exportEarnings: round(0.97),
    zeroValueExportKwh: 0,
    zeroValueExportEur: 0,
    standingCharge: round(0.42),
    net: round(1.97),
    gridOnlyCost: round(5.88),
    savings: round(4.33),
    solarSavings: round(3.36),
    solarToLoadKwh: round(11.2),
    selfSufficiency: 0.571,
    selfConsumption: 0.502,
    byDay: [
      {
        date: firstDay,
        importKwh: round(8.4),
        exportKwh: round(12.1),
        importCost: round(2.52),
        exportEarnings: round(0.97),
        net: round(1.97),
      },
    ],
    byBand: [{ name: "Standard", importKwh: round(8.4), cost: round(2.52) }],
  };
}

/** Bucket key format per `bucket` param, as `apps/server/src/energy/cost.ts` emits it. */
function bucketKey(at: Date, bucket: string): string {
  const iso = at.toISOString();
  if (bucket === "hour") return iso.slice(0, 13);
  if (bucket === "month") return iso.slice(0, 7);
  return iso.slice(0, 10);
}

const BUCKET_MS: Record<string, number> = {
  hour: 3_600_000,
  day: DAY_MS,
  month: 30 * DAY_MS,
};

/**
 * One point per bucket across `[from, to)`, capped so a two-year monthly window
 * and a one-day hourly window both stay cheap.
 */
function buckets(from: string, to: string, bucket: string): Date[] {
  const start = Date.parse(from) || Date.now() - DAY_MS;
  const end = Date.parse(to) || Date.now();
  const step = BUCKET_MS[bucket] ?? BUCKET_MS.day!;
  const count = Math.min(400, Math.max(2, Math.ceil((end - start) / step)));
  return Array.from({ length: count }, (_, i) => new Date(start + i * step));
}

/**
 * One bar of the cost chart — `CostSeriesPoint` in `apps/server/src/energy/cost.ts`.
 *
 * Restated rather than imported: the type is assembled in the server app, not in
 * `@SunReye/contracts`, and `statistics/cost-section.svelte` restates it too.
 */
export interface CostSeriesPointFixture {
  bucket: string;
  importCost: number;
  exportEarnings: number;
  zeroValueExportKwh: number;
  zeroValueExportEur: number;
  standingCharge: number;
  net: number;
}

/**
 * `GET /api/cost/series` — `CostSeriesPoint[]`.
 *
 * Never `[]`: `costHasData` in `statistics/cost-section.svelte` self-hides the
 * chart on an empty series, and a hidden chart passes any assertion about it.
 */
export function costSeries(from: string, to: string, bucket: string): CostSeriesPointFixture[] {
  return buckets(from, to, bucket).map((at, i) => {
    const swing = Math.sin(i / 5) * 0.6 + 1;
    const importCost = Math.round(2.52 * swing * 100) / 100;
    const exportEarnings = Math.round(0.97 * swing * 100) / 100;
    return {
      bucket: bucketKey(at, bucket),
      importCost,
      exportEarnings,
      zeroValueExportKwh: 0,
      zeroValueExportEur: 0,
      standingCharge: 0.42,
      net: Math.round((importCost + 0.42 - exportEarnings) * 100) / 100,
    };
  });
}

/** One `PeriodEnergy` (`packages/contracts/src/energy/types.ts`). */
function periodEnergy(bucket: string, scale = 1): PeriodEnergy {
  const round = (n: number) => Math.round(n * scale * 100) / 100;
  return {
    bucket,
    importKwh: round(8.4),
    exportKwh: round(12.1),
    loadKwh: round(19.6),
    productionKwh: round(24.3),
    batteryDischargeKwh: round(4.2),
    batteryChargeKwh: round(5.1),
    gridToLoadKwh: round(8.4),
    solarToLoadKwh: round(11.2),
    batteryToLoadKwh: round(4.2),
    solarDirectToLoadKwh: round(7),
    selfConsumedKwh: round(12.2),
    exportedKwh: round(12.1),
    selfSufficiency: 0.571,
    selfConsumption: 0.502,
  };
}

/** `GET /api/energy/series` — `PeriodEnergy[]`. */
export function energySeries(from: string, to: string, bucket: string): PeriodEnergy[] {
  return buckets(from, to, bucket).map((at, i) =>
    periodEnergy(bucketKey(at, bucket), Math.sin(i / 4) * 0.3 + 1),
  );
}

/**
 * The reference window `[from, to)` is compared against — `previousWindow` in
 * `apps/server/src/statistics/statistics-calc.ts`, restated.
 *
 * The previous breakdown used to be priced over the CURRENT window's bounds,
 * which no server response can look like: `computeComparison` prices
 * `previousWindow(...)` and returns that earlier window's own `from`/`to`.
 */
function previousWindow(from: string, to: string, mode: string): { from: string; to: string } {
  const start = Date.parse(from) || Date.now() - DAY_MS;
  const end = Date.parse(to) || Date.now();
  if (mode === "yearAgo") {
    const shift = (ms: number) => {
      const d = new Date(ms);
      d.setFullYear(d.getFullYear() - 1);
      return d.toISOString();
    };
    return { from: shift(start), to: shift(end) };
  }
  return { from: new Date(start - (end - start)).toISOString(), to: new Date(start).toISOString() };
}

/**
 * `GET /api/statistics/comparison` — `ComparisonResponse`.
 *
 * `coverage.dataFrom` is deliberately ancient: `usableComparison()` drops the
 * reference window when it predates recorded history, and then no delta chip
 * ever renders — an assertion about the comparison would be vacuous.
 */
export function comparison(from: string, to: string, mode: string): ComparisonResponse {
  const prev = previousWindow(from, to, mode);
  return {
    mode: mode === "yearAgo" ? "yearAgo" : "previous",
    current: costBreakdown(from, to),
    previous: costBreakdown(prev.from, prev.to, 1.18),
    coverage: { dataFrom: ago(900 * DAY_MS) },
  };
}

/** `GET /api/statistics/heatmap` — the full 24×7 grid of `HeatmapCell`. */
export function heatmap(): HeatmapCell[] {
  const cells: HeatmapCell[] = [];
  for (let dow = 1; dow <= 7; dow++) {
    for (let hod = 0; hod < 24; hod++) {
      const daylight = Math.max(0, Math.sin(((hod - 6) / 12) * Math.PI));
      cells.push({
        hod,
        dow,
        occurrences: 4,
        importKwh: Math.round((1.2 - daylight) * 100) / 100,
        exportKwh: Math.round(daylight * 2.4 * 100) / 100,
        loadKwh: 3.1,
        productionKwh: Math.round(daylight * 5 * 100) / 100,
        batteryDischargeKwh: 0.8,
        batteryChargeKwh: 1.1,
      });
    }
  }
  return cells;
}

/**
 * `GET /api/statistics/records` — `RecordsResponse`.
 *
 * Both halves are legally `null` before one complete day of history, which
 * renders the records section empty; this is the populated case. Every day is
 * relative: an all-time record dated in the FUTURE is a state no server can
 * produce, and a literal one becomes exactly that the moment the calendar
 * passes it.
 */
export function records(): RecordsResponse {
  return {
    energy: {
      since: dayKey(900),
      maxProductionDay: { date: dayKey(58), value: 41.7 },
      maxExportDay: { date: dayKey(58), value: 28.3 },
      maxLoadDay: { date: dayKey(216), value: 34.9 },
      maxImportDay: { date: dayKey(216), value: 30.2 },
      bestSelfSufficiencyDay: { date: dayKey(58), value: 1 },
      worstSelfSufficiencyDay: { date: dayKey(234), value: 0.04 },
    },
    money: {
      since: dayKey(780),
      currency: "EUR",
      cheapestDay: { date: dayKey(58), value: -3.42 },
      mostExpensiveDay: { date: dayKey(216), value: 9.87 },
      bestEarningsDay: { date: dayKey(58), value: 6.11 },
    },
  };
}

// ─── Spot prices ────────────────────────────────────────────────────────────

/**
 * The market's own UTC offset. Same zone as the plant here (DE-LU / Berlin),
 * but a separate constant on purpose: `prices-section.svelte` takes the offset
 * for its history list from the PRICE payload, never from the forecast.
 */
const MARKET_UTC_OFFSET_SECONDS = 7200;

/** Wholesale price of the `i`-th quarter-hour of a delivery day, EUR/MWh. */
const slotPrice = (i: number): number => Math.round((64.2 + Math.sin(i / 8) * 70) * 10) / 10;

/** One market-local delivery day of 96 priced quarter-hours. */
function priceDay(dayOffset: number): PricedSlot[] {
  const dayStart = localDayStartMs(MARKET_UTC_OFFSET_SECONDS, dayOffset);
  return Array.from({ length: 96 }, (_, i) => {
    const at = dayStart + i * 15 * 60_000;
    const eurPerMwh = slotPrice(i + dayOffset * 7);
    return {
      time: localWallClock(at, MARKET_UTC_OFFSET_SECONDS),
      startMs: at,
      minutes: 15,
      eurPerMwh,
      negative: eurPerMwh < 0,
      importPerKwh: Math.round((eurPerMwh / 1000 + 0.25) * 1000) / 1000,
      exportPerKwh: Math.round((eurPerMwh / 1000) * 1000) / 1000,
    };
  });
}

const ATTRIBUTION =
  "Preisdaten: Bundesnetzagentur | SMARD.de (CC BY 4.0), via Fraunhofer ISE energy-charts";

/**
 * `GET /api/prices` — `SpotPriceView`. `null` when the feed is off.
 *
 * Today AND tomorrow, because that is what the job keeps stocked and what
 * `coverage: {today: "complete", tomorrow: "complete"}` claims. Every derived
 * figure — the extremes, both negative-slot counts — is COMPUTED from the
 * series it ships with, so the payload cannot state a summary its own data
 * contradicts (it used to claim a complete tomorrow with no tomorrow in it, and
 * 4 negative slots today over a series holding 13).
 */
export function spotPriceView(): SpotPriceView {
  const today = priceDay(0);
  const tomorrow = priceDay(1);
  const series = [...today, ...tomorrow];
  const negatives = (day: PricedSlot[]) => day.filter((p) => p.negative).length;
  const prices = series.map((p) => p.eurPerMwh);
  return {
    provider: "energy-charts",
    zone: "DE-LU",
    attribution: ATTRIBUTION,
    resolutionMinutes: 15,
    utcOffsetSeconds: MARKET_UTC_OFFSET_SECONDS,
    coverage: { today: "complete", tomorrow: "complete" },
    availability: "ok",
    series,
    extremes: { minEurPerMwh: Math.min(...prices), maxEurPerMwh: Math.max(...prices) },
    negativeSlots: { today: negatives(today), tomorrow: negatives(tomorrow) },
  };
}

/**
 * `GET /api/statistics/prices` — `SpotStats`. `null` when the feed is off.
 *
 * The two days it details are yesterday and the day before, so the section's
 * "last N days" clamp always has something inside it.
 */
export function spotStats(from: string, to: string): SpotStats {
  const negativeStart = localDayStartMs(MARKET_UTC_OFFSET_SECONDS, -1) + 12 * 3_600_000;
  return {
    zone: "DE-LU",
    currency: "EUR",
    from,
    to,
    summary: {
      avgEurPerMwh: 78.4,
      minEurPerMwh: -12.5,
      maxEurPerMwh: 240.1,
      slots: 2880,
      negativeSlots: 36,
      negativeHours: 9,
    },
    daily: [
      {
        date: dayKey(2),
        avgEurPerMwh: 71.9,
        minEurPerMwh: -4.2,
        maxEurPerMwh: 198.3,
        slots: 96,
        negativeSlots: 2,
      },
      {
        date: dayKey(1),
        avgEurPerMwh: 78.4,
        minEurPerMwh: -12.5,
        maxEurPerMwh: 240.1,
        slots: 96,
        negativeSlots: 4,
      },
    ],
    negativeWindows: [
      {
        start: new Date(negativeStart).toISOString(),
        end: new Date(negativeStart + 2 * 3_600_000).toISOString(),
        minEurPerMwh: -12.5,
        slots: 8,
      },
    ],
    negativeWindowsTruncated: false,
    paidVsMarket: { importKwh: 210.4, importWeightedAvgEurPerMwh: 71.2, coverage: 0.98 },
    whatIf: {
      staticCost: 63.1,
      spotCost: 55.4,
      delta: -7.7,
      spotComponentsConfigured: true,
      coverage: 0.98,
    },
  };
}

/**
 * `GET /api/prices/providers` — `spotProviderCatalog()`
 * (`apps/server/src/prices/spot-price-job.ts`), zone lists copied from the two
 * registered providers rather than sampled.
 *
 * The energy-charts list is the upstream's own advertised set
 * (`prices/providers/energy-charts.ts`); a trimmed thirteen-zone version of it
 * shipped here for a while under a comment that called it "the real registry",
 * which is the sort of half-truth that makes a green settings test worthless.
 */
export const PRICE_PROVIDERS: { id: string; zones: string[]; attribution: string }[] = [
  {
    id: "energy-charts",
    zones: [
      "AT",
      "BE",
      "BG",
      "CH",
      "CZ",
      "DE-LU",
      "DE-AT-LU",
      "DK1",
      "DK2",
      "EE",
      "ES",
      "FI",
      "FR",
      "GR",
      "HR",
      "HU",
      "IT-Calabria",
      "IT-Centre-North",
      "IT-Centre-South",
      "IT-North",
      "IT-SACOAC",
      "IT-SACODC",
      "IT-Sardinia",
      "IT-Sicily",
      "IT-South",
      "LT",
      "LV",
      "ME",
      "NL",
      "NO1",
      "NO2",
      "NO3",
      "NO4",
      "NO5",
      "PL",
      "PT",
      "RO",
      "RS",
      "SE1",
      "SE2",
      "SE3",
      "SE4",
      "SI",
      "SK",
    ],
    attribution: ATTRIBUTION,
  },
  { id: "awattar", zones: ["AT", "DE-LU"], attribution: "Preisdaten: aWATTar" },
];

// ─── Forecast ───────────────────────────────────────────────────────────────

/** `GET /api/forecast/providers` — the one registered provider. */
export const FORECAST_PROVIDERS = [
  { id: "open-meteo", label: "Open-Meteo", capabilities: { dni: true, windSpeed: true } },
];

/** `GET /api/forecast/correction` — `ForecastCorrectionView`, the learned branch. */
export function forecastCorrection() {
  const month = new Date().getUTCMonth() + 1;
  return {
    enabled: true,
    learnedThrough: dayKey(1),
    skill: { maeRaw: 420, maeCorrected: 310, improvementPct: 26.2, samples: 1440 },
    cells: [
      { month, hour: 11, factor: 1.02, weight: 38 },
      { month, hour: 12, factor: 1.08, weight: 42 },
    ],
  };
}

// ─── Settings (every `GET /api/settings/*`) ─────────────────────────────────

/** `packages/db/src/ui-prefs.ts` → `defaultUiPrefs` — nothing hidden. */
export const UI_PREFS = { hiddenKeys: [], hiddenGroups: [] };

/**
 * `packages/db/src/display.ts` → `defaultDisplay`, pinned to a 24-hour clock so
 * the display panel's picker has a value worth asserting.
 */
export const DISPLAY = { hourCycle: "24h", timeZone: "Europe/Berlin" };

/** `packages/db/src/chart-palette.ts` → `defaultChartPalette`. */
export const CHART_PALETTE = { preset: "categorical" };

/** `packages/db/src/plant.ts` → `defaultPlant`. */
export const PLANT = { timeZone: "auto" };

/** `packages/db/src/access.ts` → `defaultAccess`. */
export const ACCESS = { publicDashboard: false };

/** `packages/db/src/statistics-prefs.ts` → `defaultStatisticsPrefs`. */
/**
 * Measured battery capacity and state of health.
 *
 * All-null: a plant needs several deep discharges before any of it exists, and
 * "not measured yet" is the state most specs should see. Null is not "healthy" —
 * the tiles render absent, which is the behaviour worth being the default.
 */
export const BATTERY_HEALTH = {
  capacity: null,
  baseline: null,
  health: null,
  trend: [],
};

export const STATISTICS_PREFS = {
  hiddenSections: [],
  hiddenTiles: [],
  collapsedSections: [],
  cost: { chartScope: "detail" },
  energy: { bucket: "day", chartScope: "detail", heatmapField: "load" },
  prices: { windowDays: 90 },
  records: { compareMode: "previous", yoyMetric: "net" },
};

/** `packages/db/src/tariff.ts` → `defaultTariff`, with a real import price. */
export const TARIFF = {
  currency: "EUR",
  standingChargeMonthly: 12.5,
  import: {
    mode: "static",
    defaultPricePerKwh: 0.31,
    bands: [],
    spot: {
      supplierMarkupPerKwh: 0,
      gridFeesPerKwh: 0,
      leviesPerKwh: 0,
      vatPercent: 0,
      clampToZero: false,
    },
  },
  export: {
    mode: "static",
    feedInPerKwh: 0.082,
    spot: { marketingModel: "none", managementFeePerKwh: 0 },
  },
};

/**
 * `packages/db/src/inverter-config.ts` → `inverterConfigSchema.parse({})`, with
 * a host filled in. The schema leaves `host` absent, and an absent host renders
 * an empty input — which no assertion can tell apart from "the payload never
 * arrived".
 */
export const INVERTER_CONFIG = {
  host: "10.0.0.5",
  port: 502,
  transport: "tcp",
  unitId: 0,
  timeoutMs: 2000,
  pollIntervalMs: 1000,
};

/** `packages/db/src/mqtt-config.ts` → `maskMqttConfig(mqttConfigSchema.parse({}))`. */
export const MQTT_CONFIG = {
  enabled: false,
  brokerUrl: "mqtt://localhost:1883",
  topicPrefix: "sunreye",
  haDiscoveryEnabled: false,
  haDiscoveryPrefix: "homeassistant",
  hasPassword: false,
};

/** `packages/db/src/evcc-config.ts` → `defaultEvcc`. */
export const EVCC_CONFIG = { enabled: false, topicRoot: "evcc", subtractFromHome: false };

/** `apps/server/src/settings/logging-settings.ts` — config plus resolved level. */
export const LOGGING = { level: null, effective: "info", default: "info" };

/**
 * `packages/db/src/weather.ts` → `defaultWeather`, configured for Berlin.
 *
 * The default has `latitude: null` and `enabled: false`, which renders empty
 * inputs and hides the forecast half of the panel entirely.
 */
export const WEATHER_CONFIG = {
  enabled: true,
  latitude: 52.52,
  longitude: 13.405,
  label: "Berlin",
  forecast: {
    enabled: true,
    provider: "open-meteo",
    arrays: [{ name: "Roof south", kwp: 8.4, tilt: 35, azimuth: 0 }],
    tempCoefficient: -0.4,
    systemLoss: 14,
    maxOutputW: null,
    battery: null,
    houseLoadW: null,
    smartMeterSince: null,
    correction: { enabled: true },
  },
};

/** `packages/db/src/spot-price-config.ts` → `defaultSpotPriceConfig`. */
export const SPOT_PRICE_CONFIG = { enabled: true, provider: "energy-charts", zone: "DE-LU" };

/**
 * `packages/db/src/automation-config.ts` → `defaultAutomations`, with the master
 * switch ON.
 *
 * Off is the default, and off replaces the whole peak-shaving form with a
 * "turn automations on first" alert — so the shipped default would make every
 * assertion about that page's controls vacuous.
 */
export function automations() {
  return {
    enabled: true,
    disclaimerAcceptedAt: ago(48 * DAY_MS),
    peakShaving: {
      enabled: false,
      shadowMode: false,
      mode: "maximize-exports",
      safetyBufferW: 500,
      maxChargeA: 100,
      fallbackChargeA: 50,
      topBalanceFloorA: 5,
      nominalBatteryV: 51.2,
      controlIntervalS: 30,
      gridFriendly: {
        minThresholdW: 0,
        forecastTrustPct: 100,
        slewWPerMin: 600,
        chargeSlewAPerMin: 10,
        reserveForEvDemand: true,
      },
      priceAware: {
        enabled: false,
        negativeThresholdEurPerMwh: 0,
        minWindowMinutes: 15,
        bridgeGapSlots: 1,
        lookaheadHours: 8,
        soakFloorW: 0,
        shapeSoc: true,
        reserveMarginPct: 5,
        pullInEv: false,
        evBoostLimitPct: 10,
        gridChargeInWindow: false,
        gridChargeMaxA: 20,
      },
    },
  };
}

// ─── Profiles ───────────────────────────────────────────────────────────────

const OFFICIAL_SOURCE = "https://github.com/SunReye/SunReye-Official-Profiles";

/** `GET /api/settings/profile-sources` — sources plus the server's `official` flag. */
export const PROFILE_SOURCES = {
  sources: [
    { url: OFFICIAL_SOURCE, label: "SunReye Official Profiles", enabled: true, official: true },
  ],
};

/** `GET /api/profiles` — the registered profiles, aligned with the fixture manifest. */
export function profiles(manifest: FixtureManifest) {
  // `version` is `undefined` for built-ins on the real server: the key is
  // omitted, never sent as null.
  return [
    {
      id: manifest.id,
      name: manifest.name,
      manufacturer: manifest.manufacturer,
      active: true,
      installed: false,
      builtin: true,
    },
    {
      id: "sungrow-sh10rt",
      name: "Sungrow SH10RT",
      manufacturer: "Sungrow",
      active: false,
      installed: true,
      builtin: false,
      version: "1.4.2",
    },
  ];
}

/** `GET /api/profiles/updates` — `UpdateCheckResult`, the "checked, nothing new" state. */
export function profileUpdates() {
  return { checkedAt: ago(600_000), updates: [], errors: [] };
}

/**
 * `GET /api/profiles/available` — the Browse action's catalogue.
 *
 * Three entries across two manufacturers and two Deye families, because
 * `available-profile-group.svelte` groups manufacturer → family → SKU: a
 * one-entry catalogue renders one row and never runs the grouping at all.
 */
export const AVAILABLE_PROFILES = {
  profiles: [
    {
      id: "deye-sunsynk-sg04lp3",
      name: "Deye SUN-12K-SG04LP3",
      manufacturer: "Deye",
      version: "1.2.0",
      path: "profiles/deye-sg04lp3.json",
      description: "Three-phase hybrid",
      source: OFFICIAL_SOURCE,
      installed: false,
      updateAvailable: false,
    },
    {
      id: "deye-sunsynk-sg04lp3-8k",
      name: "Deye SUN-8K-SG04LP3",
      manufacturer: "Deye",
      version: "1.2.0",
      path: "profiles/deye-sg04lp3-8k.json",
      description: "Three-phase hybrid",
      source: OFFICIAL_SOURCE,
      installed: false,
      updateAvailable: false,
    },
    {
      id: "sungrow-sh10rt",
      name: "Sungrow SH10RT",
      manufacturer: "Sungrow",
      version: "1.4.2",
      path: "profiles/sungrow-sh10rt.json",
      description: "Three-phase hybrid",
      source: OFFICIAL_SOURCE,
      installed: true,
      updateAvailable: true,
    },
  ],
  errors: [],
};

// ─── Admin ──────────────────────────────────────────────────────────────────

/** `GET /api/admin/api-keys` — `[]` is legal and renders the empty state. */
export function apiKeys(user: { id: string; email: string; name: string }) {
  return [
    {
      id: "key-1",
      name: "Home Assistant",
      prefix: "sr",
      start: "sr_abcd",
      enabled: true,
      expiresAt: null,
      lastRequest: null,
      createdAt: new Date(0).toISOString(),
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
    },
  ];
}

// ─── Live socket payloads ───────────────────────────────────────────────────

/** `evcc` topic — `EvccState`, one loadpoint with every field populated. */
export const EVCC_STATE = {
  reachable: true,
  subtractFromHome: false,
  loadpoints: [
    {
      index: 1,
      title: "Carport",
      mode: "pv",
      chargePower: 6800,
      chargePowerLive: 6800,
      chargePowerSource: "measured",
      charging: true,
      connected: true,
      vehicleSoc: 62,
      vehicleRange: 280,
      vehicleTitle: "Model 3",
      vehicleName: "tesla_ble",
      sessionEnergy: 12_400,
      chargeRemainingEnergy: 8200,
      limitSoc: 0,
      effectiveLimitSoc: 80,
      vehicleLimitSoc: 90,
      batteryBoost: false,
      batteryBoostLimit: 100,
      vehicleCapacityKwh: 57.5,
      phasesActive: 3,
    },
  ],
} satisfies EvccState;

/** The engine's live status, as the `automations` topic carries it. */
function peakShavingStatus(nowMs: number): PeakShavingStatus {
  return {
    enabled: true,
    mode: "maximize-exports",
    state: "idle",
    blockers: [],
    priceBlockers: [],
    lastTickAt: new Date(nowMs).toISOString(),
    lastWriteAt: null,
    lastError: null,
    targetA: null,
    lastWrittenA: null,
    liveA: null,
    thresholdW: 3000,
    sellLimitW: null,
    liveSellLimitW: null,
    gridChargeA: null,
    liveExcessW: 1840,
    loadW: 640,
    headroomKwh: 4.2,
    usableKwh: 9.6,
    remainingAboveLimitKwh: null,
    evChargeW: null,
    evDemandKwh: null,
    forecastAvailable: true,
    externalOverride: false,
    ineffective: false,
    restorePending: false,
    priceRegime: "none",
    socEnvelopePct: null,
    windowStartsAt: null,
    windowEndsAt: null,
    soakableKwh: null,
    unavoidableZeroValueKwh: null,
  };
}

/**
 * One tick of the engine's decision log — `DecisionPoint`.
 *
 * Every field of the contract, and no field that is not in it. The shape that
 * shipped here first (`at`/`excessW`/`soc`) meant `toDecisionRows` computed its
 * window from `newest.t === undefined` → `NaN`, filtered every point out, and
 * handed the charts an empty array while `hasRegister` answered `true` on
 * `undefined !== null` — a register series with no data, which the server
 * cannot produce because `liveA` is `number | null`.
 */
function decisionPoint(atMs: number, i: number): DecisionPoint {
  const pvW = 3200 + i * 90;
  const loadW = 640;
  return {
    t: atMs,
    shadow: false,
    pvW,
    loadW,
    evChargeW: null,
    localSinkW: loadW,
    thresholdW: 3000,
    targetA: 40,
    liveA: 38 + (i % 3),
    batteryV: 51.2,
    chargeW: Math.max(0, pvW - loadW - 3000),
    exportW: 3000,
    socPct: 55 + i,
  };
}

/** `automations` topic — `AutomationStreamMessage`; `status` is `PeakShavingStatus`. */
export function automationStream(overrides: Partial<AutomationStreamMessage> = {}) {
  const now = Date.now();
  return {
    tickMs: 30_000,
    point: null,
    plan: null,
    // `history: []` still flips the page's `loaded` flag, but a page that draws
    // decision charts from an empty ring is a skeleton with a heading on it.
    history: Array.from({ length: 12 }, (_, i) => decisionPoint(now - (11 - i) * 30_000, i)),
    status: peakShavingStatus(now),
    ...overrides,
  } satisfies AutomationStreamMessage;
}

/** `statistics` topic — `StatisticsTodayMessage`. */
export function statisticsToday(): StatisticsTodayMessage {
  return {
    type: "today",
    at: new Date().toISOString(),
    cost: costBreakdown(ago(DAY_MS), new Date().toISOString()),
    energy: periodEnergy(new Date().toISOString().slice(0, 10)),
  };
}

/**
 * `logs` topic — a batch of `LogEntry`. The one array-valued topic.
 *
 * `"warning"`, not `"warn"`: the level union is declared in
 * `packages/contracts/src/logs/types.ts` and `log-levels.ts` keys its colour
 * map on it, so a `"warn"` line rendered unstyled — a level the real server can
 * never emit, which no assertion here would have caught.
 */
export function logBatch(): LogEntry[] {
  const now = Date.now();
  return [
    { time: now - 2000, level: "info", category: "server.inverter", message: "poll ok" },
    {
      time: now - 1000,
      level: "warning",
      category: "server.mqtt",
      message: "broker not configured",
    },
  ];
}
