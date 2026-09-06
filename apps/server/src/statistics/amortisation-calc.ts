/**
 * Pure amortisation arithmetic — no database, no inverter. Prices the plant's
 * lifetime counters against flat rates and projects when the investment pays
 * for itself. The DB-bound orchestration lives in statistics.ts.
 */

import type { EnergyTotals } from "@SunReye/contracts/energy";
import type { AmortisationResponse, SeasonalGap } from "@SunReye/contracts/statistics";
import type { InvestmentConfig } from "@SunReye/db/investment";

const DAY_MS = 86_400_000;
const DAYS_PER_YEAR = 365.25;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export interface AmortisationInputs {
  currency: string;
  investment: InvestmentConfig;
  /** The device's lifetime `*.total` counters. */
  lifetime: EnergyTotals;
  /** Whether the plant meters house consumption at all — decides how
   *  self-consumption is derived (see {@link selfConsumedKwh}). */
  metersLoad: boolean;
  /** Flat per-kWh rates the lifetime figures are priced at. */
  rates: { importPrice: number; exportPrice: number };
  /** First day of recorded history — the fallback origin when the
   *  commissioning day is unknown. */
  recordedSince: Date | null;
  /**
   * Elapsed time since the origin in SOLAR years (see `seasonal-weight.ts`), or
   * null when the plant has no roof geometry to weight by — the calendar then
   * measures it. The orchestration supplies it because it needs the origin,
   * which {@link amortisationOrigin} resolves for both.
   */
  solarYears: number | null;
  /** Why `solarYears` is null — see `seasonalGaps`; empty when it is not. */
  seasonalGaps: SeasonalGap[];
  now: Date;
}

/**
 * Solar the house used instead of buying. `load − import` where consumption is
 * metered (the same figure `solarSavings` values, so the two tiles agree);
 * `production − export` where it is not — on a plant without a battery the two
 * coincide, and with one the difference is the battery's round-trip loss, which
 * an unmetered plant cannot see anyway. Registers lead each other mid-poll, so
 * never below zero.
 */
function selfConsumedKwh(lifetime: EnergyTotals, metersLoad: boolean): number {
  return Math.max(
    0,
    metersLoad
      ? lifetime.loadKwh - lifetime.importKwh
      : lifetime.productionKwh - lifetime.exportKwh,
  );
}

/** Midnight UTC of a `YYYY-MM-DD` day. */
function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** Whole days from `since` to `now`, never negative. */
function daysBetween(since: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS));
}

/** The day the savings run from: commissioning when known, else the first
 *  recorded day. Both the instant (for arithmetic) and the label the wire carries. */
export function amortisationOrigin(
  investment: InvestmentConfig,
  recordedSince: Date | null,
): { at: Date | null; since: string | null } {
  if (investment.commissionedOn) {
    return { at: dayStart(investment.commissionedOn), since: investment.commissionedOn };
  }
  return { at: recordedSince, since: recordedSince?.toISOString() ?? null };
}

/**
 * When the plant pays for itself: how long it took when already paid off,
 * else the remainder projected at the annual rate. A zero or negative rate
 * never pays back, and an unconfigured plant has nothing to pay back.
 */
function payback(
  totalCost: number,
  annualRate: number | null,
  elapsedYears: number,
  paidOff: boolean,
  now: Date,
): Pick<AmortisationResponse, "paybackDate" | "paybackYears"> {
  if (totalCost <= 0 || annualRate === null || annualRate <= 0) {
    return { paybackDate: null, paybackYears: null };
  }
  const totalYears = totalCost / annualRate;
  return {
    paybackYears: totalYears,
    paybackDate: paidOff
      ? null
      : new Date(
          now.getTime() + (totalYears - elapsedYears) * DAYS_PER_YEAR * DAY_MS,
        ).toISOString(),
  };
}

/** Progress and remainder against the price, both clamped to `[0, totalCost]`:
 *  a rebate tariff can put savings below zero, and "more than the plant cost
 *  is left to recover" reads as a bug, not a fact. Null when unconfigured. */
function recovery(
  totalCost: number,
  savings: number,
): Pick<AmortisationResponse, "progress" | "remaining" | "paidOff"> {
  if (totalCost <= 0) return { progress: null, remaining: null, paidOff: false };
  return {
    progress: clamp01(savings / totalCost),
    remaining: Math.min(totalCost, Math.max(0, totalCost - savings)),
    paidOff: savings >= totalCost,
  };
}

export function amortisation(input: AmortisationInputs): AmortisationResponse {
  const { investment, lifetime, rates, now } = input;
  const selfConsumed = selfConsumedKwh(lifetime, input.metersLoad);
  const importSavings = selfConsumed * rates.importPrice;
  const exportEarnings = lifetime.exportKwh * rates.exportPrice;
  const savings = importSavings + exportEarnings;

  const from = amortisationOrigin(investment, input.recordedSince);
  const elapsedDays = from.at ? daysBetween(from.at, now) : 0;
  // Solar years when the roof is known, else the calendar; either way nothing
  // is annualised before a whole day has passed.
  const weighting = input.solarYears === null ? "calendar" : "solar";
  const elapsedYears = elapsedDays === 0 ? 0 : (input.solarYears ?? elapsedDays / DAYS_PER_YEAR);
  const annualRate = elapsedYears > 0 ? savings / elapsedYears : null;
  const recovered = recovery(investment.totalCost, savings);

  return {
    currency: input.currency,
    configured: investment.totalCost > 0,
    investment: { totalCost: investment.totalCost, commissionedOn: investment.commissionedOn },
    since: from.since,
    elapsedDays,
    lifetime: {
      importKwh: lifetime.importKwh,
      exportKwh: lifetime.exportKwh,
      productionKwh: lifetime.productionKwh,
      loadKwh: lifetime.loadKwh,
      selfConsumedKwh: selfConsumed,
    },
    rates,
    importSavings,
    exportEarnings,
    savings,
    ...recovered,
    elapsedYears,
    weighting,
    seasonalGaps: weighting === "solar" ? [] : input.seasonalGaps,
    annualRate,
    ...payback(investment.totalCost, annualRate, elapsedYears, recovered.paidOff, now),
  };
}
