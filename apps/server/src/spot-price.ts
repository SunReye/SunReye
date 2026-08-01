/**
 * Day-ahead spot prices: the provider contract, the market calendar, and the
 * pure shaping between a stored row and something the UI or an automation can
 * read. No DB, no network, no clock of its own — {@link ./spot-price-job} owns
 * the impure half, mirroring the `solar-forecast` / `cost` split.
 *
 * Why this exists at all: under §51 EEG a plant is paid **nothing** for energy
 * exported during a quarter-hour whose day-ahead price was negative. So "which
 * slots are negative, today and tomorrow" is a first-class input, and the
 * 15-minute resolution is not a detail — EPEX DE-LU moved to quarter-hour
 * products on 2025-10-01, and an hourly average hides exactly the slots that
 * matter.
 *
 * IMPORTANT, and the reason several functions look defensive: **an absent slot
 * means _unknown_, never 0 EUR/MWh.** Zero is a semantically loaded value here —
 * conflating "no data" with "zero price" would make every gap look like a
 * zero-remuneration slot to the actuator. Missing data is therefore always
 * represented by the slot being absent and surfaced through
 * {@link SpotSlice.availability} / {@link SpotSlice.coverage}, never by a
 * substituted number.
 */

import type { SpotPriceInsert, SpotPriceRow } from "@SunReye/db/schema/spot-price";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const QUARTER_MS = 900_000;
const DAY_MS = 86_400_000;

/** The grid every stored row sits on, minutes. Hourly sources are fanned out to it. */
export const SLOT_MINUTES = 15;

// --- Provider contract --------------------------------------------------------

/** One contiguous run of priced slots as a provider returned it. */
export interface SpotPriceSeries {
  zone: string;
  /** Slot start instants, epoch ms, ascending. */
  startMs: number[];
  /** Wholesale price per slot, EUR/MWh. **Signed.** Parallel to {@link startMs}. */
  eurPerMwh: number[];
  /** Nominal width the upstream published, minutes (15 or 60). */
  resolutionMinutes: number;
}

export interface SpotPriceProvider {
  readonly id: string;
  /** Bidding zones this provider serves — feeds the settings dropdown. */
  readonly zones: readonly string[];
  /**
   * Credit line the UI **must** render. Not decoration: the default source
   * republishes under CC BY 4.0, where attribution is a licence condition.
   */
  readonly attribution: string;
  /**
   * Slots covering `[fromMs, toMs)`. MAY return fewer when the day-ahead auction
   * for the tail of the range has not cleared yet; MUST throw
   * {@link SpotPriceUnpublished} when the upstream rejects the range outright
   * rather than truncating it.
   */
  fetch(zone: string, fromMs: number, toMs: number): Promise<SpotPriceSeries>;
}

/**
 * The requested delivery day is not published yet. Distinct from a transport
 * failure: this is the expected state before ~13:00 market time, so the job logs
 * it at debug and keeps the stored series, instead of warning about it hourly.
 */
export class SpotPriceUnpublished extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpotPriceUnpublished";
  }
}

// --- Market calendar ----------------------------------------------------------

/**
 * IANA zone the market's delivery day is measured in.
 *
 * Deliberately *not* the server's time zone (which is what the cost engine uses)
 * and *not* the plant's: a delivery day is a property of the auction. Identical
 * for a German plant on DE-LU, which is exactly why getting it wrong would go
 * unnoticed until someone runs the app from another continent.
 */
export function zoneTimeZone(zone: string): string {
  if (zone === "AT") return "Europe/Vienna";
  if (zone.startsWith("NO")) return "Europe/Oslo";
  if (zone.startsWith("SE")) return "Europe/Stockholm";
  if (zone.startsWith("DK")) return "Europe/Copenhagen";
  return "Europe/Berlin";
}

const partsFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = partsFormatter(timeZone);
    formatterCache.set(timeZone, f);
  }
  return f;
};

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function localParts(timeZone: string, atMs: number): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(atMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** Offset of `timeZone` at an instant, ms east of UTC. */
function zoneOffsetMs(timeZone: string, atMs: number): number {
  const p = localParts(timeZone, atMs);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) -
    Math.floor(atMs / MINUTE_MS) * MINUTE_MS
  );
}

/**
 * Instant of local midnight starting the local day that contains `atMs`.
 *
 * Two passes: the first uses the offset at `atMs`, the second re-resolves at the
 * candidate instant, which is what makes it correct on the two days a year when
 * the offset changes between midnight and now.
 */
export function localDayStartMs(timeZone: string, atMs: number): number {
  const first = zoneOffsetMs(timeZone, atMs);
  const localMidnight = Math.floor((atMs + first) / DAY_MS) * DAY_MS;
  const candidate = localMidnight - first;
  const second = zoneOffsetMs(timeZone, candidate);
  return second === first ? candidate : localMidnight - second;
}

/** Instant of the next local midnight after the local day containing `atMs`. */
export function nextLocalDayStartMs(timeZone: string, atMs: number): number {
  return localDayStartMs(timeZone, localDayStartMs(timeZone, atMs) + DAY_MS + 6 * HOUR_MS);
}

/** Local wall-clock label, `YYYY-MM-DDTHH:mm` — the shape `SolarForecastPoint.time` uses. */
function localLabel(timeZone: string, atMs: number): string {
  const p = localParts(timeZone, atMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Slots a delivery day is expected to contain. DST-aware by construction: the
 * day's *length* carries the answer, so a spring day is 92 and an autumn day 100
 * with no special case anywhere.
 */
export function expectedSlotCount(
  dayStartMs: number,
  dayEndMs: number,
  resolutionMinutes: number,
): number {
  return Math.round((dayEndMs - dayStartMs) / (resolutionMinutes * MINUTE_MS));
}

// --- Shaping ------------------------------------------------------------------

/**
 * Width of the slot starting at `startMs`: the gap to the next slot, capped at an
 * hour so a hole in the series cannot stretch one slot across it. Same rule (and
 * same reason) as the forecast's slot geometry.
 */
function slotWidthMs(startMs: number, nextMs: number | undefined, fallbackMs: number): number {
  if (nextMs === undefined) return fallbackMs;
  const gap = nextMs - startMs;
  return gap > 0 && gap <= HOUR_MS ? gap : fallbackMs;
}

/**
 * Fan an hourly series out onto the quarter-hour grid, repeating each price.
 *
 * Storing one grid keeps the key unambiguous and every reader simple. The
 * `resolutionMinutes` of the *source* is preserved so the UI can admit what was
 * lost: an hourly source cannot resolve a negative quarter-hour inside a
 * net-positive hour, which is precisely the §51 case, and pretending otherwise
 * would be the dishonest part.
 */
function expandToQuarterHours(series: SpotPriceSeries): SpotPriceSeries {
  if (series.resolutionMinutes <= SLOT_MINUTES) return series;
  const startMs: number[] = [];
  const eurPerMwh: number[] = [];
  const fallback = series.resolutionMinutes * MINUTE_MS;
  for (const [i, start] of series.startMs.entries()) {
    const price = series.eurPerMwh[i];
    // A missing price stays missing — never substitute 0.
    if (price === undefined || !Number.isFinite(price)) continue;
    const width = slotWidthMs(start, series.startMs[i + 1], fallback);
    for (let t = start; t < start + width; t += QUARTER_MS) {
      startMs.push(t);
      eurPerMwh.push(price);
    }
  }
  return { ...series, startMs, eurPerMwh };
}

/** Storable rows for a fetched series, on the quarter-hour grid. */
export function toSpotRows(series: SpotPriceSeries, provider: string): SpotPriceInsert[] {
  const grid = expandToQuarterHours(series);
  const rows: SpotPriceInsert[] = [];
  for (const [i, startMs] of grid.startMs.entries()) {
    const price = grid.eurPerMwh[i];
    if (price === undefined || !Number.isFinite(price)) continue;
    rows.push({
      zone: grid.zone,
      slotStart: new Date(startMs),
      slotMinutes: grid.resolutionMinutes,
      eurPerMwh: price,
      provider,
    });
  }
  return rows;
}

export type SlotCoverage = "complete" | "partial" | "missing";

/** Whether the automation may plan on this slice, and how far. */
export type SpotAvailability = "ok" | "today-only" | "none";

/** One priced market slot, as the API and the automations see it. */
export interface SpotPricePoint {
  /** Market-local wall clock, `YYYY-MM-DDTHH:mm` (for labels only). */
  time: string;
  /** Slot start as an absolute instant — what all matching is done on. */
  startMs: number;
  /** Nominal width of the *source* slot, minutes (60 ⇒ quarter-hours unresolved). */
  minutes: number;
  /** Wholesale price, EUR/MWh. Signed. */
  eurPerMwh: number;
  /** `eurPerMwh < 0` — the §51 zero-remuneration trigger. Strictly below zero. */
  negative: boolean;
}

/**
 * A window of priced slots plus how complete it is.
 *
 * Structurally a superset of the forecast's `ForecastSlice`, deliberately: the
 * automation walks both with the same slot geometry. `utcOffsetSeconds` is the
 * *market's* offset and must never be taken from the forecast.
 */
export interface SpotSlice {
  zone: string;
  series: SpotPricePoint[];
  stepMinutes: number;
  utcOffsetSeconds: number;
  coverage: { today: SlotCoverage; tomorrow: SlotCoverage };
  availability: SpotAvailability;
}

function coverageOf(stored: number, expected: number): SlotCoverage {
  if (stored <= 0) return "missing";
  return stored >= expected ? "complete" : "partial";
}

/** `coverage` for one delivery day given the slot starts already loaded. */
function dayCoverage(startMsList: number[], dayStartMs: number, dayEndMs: number): SlotCoverage {
  const inDay = startMsList.filter((t) => t >= dayStartMs && t < dayEndMs).length;
  return coverageOf(inDay, expectedSlotCount(dayStartMs, dayEndMs, SLOT_MINUTES));
}

function availabilityOf(coverage: SpotSlice["coverage"]): SpotAvailability {
  if (coverage.today === "missing") return "none";
  return coverage.tomorrow === "complete" ? "ok" : "today-only";
}

/**
 * Shape stored rows into a slice for today + tomorrow (market-local).
 *
 * Pure, with the clock injected, so the DST cases are directly testable.
 */
export function buildSpotSlice(
  rows: Pick<SpotPriceRow, "slotStart" | "slotMinutes" | "eurPerMwh">[],
  zone: string,
  nowMs: number,
): SpotSlice {
  const tz = zoneTimeZone(zone);
  const todayStart = localDayStartMs(tz, nowMs);
  const tomorrowStart = nextLocalDayStartMs(tz, nowMs);
  const dayAfter = nextLocalDayStartMs(tz, tomorrowStart);

  const series = rows
    .map((r) => {
      const startMs = r.slotStart.getTime();
      return {
        time: localLabel(tz, startMs),
        startMs,
        minutes: r.slotMinutes,
        eurPerMwh: r.eurPerMwh,
        negative: r.eurPerMwh < 0,
      };
    })
    .sort((a, b) => a.startMs - b.startMs);

  const starts = series.map((p) => p.startMs);
  const coverage = {
    today: dayCoverage(starts, todayStart, tomorrowStart),
    tomorrow: dayCoverage(starts, tomorrowStart, dayAfter),
  };

  return {
    zone,
    series,
    stepMinutes: SLOT_MINUTES,
    utcOffsetSeconds: zoneOffsetMs(tz, nowMs) / 1000,
    coverage,
    availability: availabilityOf(coverage),
  };
}
