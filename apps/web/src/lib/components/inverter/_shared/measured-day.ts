/**
 * Reconstructing today's measured PV production onto the forecast's slot grid.
 *
 * The solar-forecast dialog draws measured production against the forecast, so
 * it needs power per slot — which the inverter's cumulative `production.today`
 * register cannot give. It therefore integrates recorded samples instead, and
 * that reconstruction can only ever see what SunReye actually recorded.
 *
 * The register keeps climbing through a server restart or a Modbus outage; the
 * reconstruction cannot. So a slot nobody measured is `null`, never `0`, and
 * {@link measuredTotal} always returns the coverage behind its kWh figure. A
 * caller that prints the kWh without the coverage is claiming the array was
 * idle during hours it simply never observed — the bug that motivated this
 * module (dialog said 6.9 kWh, the register said 11.8 kWh for the same day).
 */

/** One minute rollup of a power metric, as served by GET /api/history/rollup. */
export interface MinuteRollup {
  time: string;
  /** Mean W over the minute. */
  avg: number;
  /** Peak W within the minute. */
  max: number;
}

/** One hour of the energy series, for the profiles that have no PV power role. */
export interface HourlyEnergy {
  /** Local period key, `YYYY-MM-DDTHH`. */
  bucket: string;
  productionKwh: number;
}

/** Measured production across one day's slot grid. `null` = not measured. */
export interface MeasuredDay {
  avgW: (number | null)[];
  peakW: (number | null)[];
}

/** A kWh figure together with the coverage that produced it. */
export interface MeasuredTotal {
  kwh: number;
  /** Elapsed slots carrying a real reading. */
  coveredSlots: number;
  /** Slots up to and including "now" — the window that could have been measured. */
  elapsedSlots: number;
  /** Every elapsed slot was measured, so the kWh figure stands on its own. */
  complete: boolean;
}

/** Slot width in minutes, guarded so a missing or absurd value cannot divide by zero. */
const normalizeStep = (stepMinutes: number): number =>
  Number.isFinite(stepMinutes) && stepMinutes >= 1 ? Math.floor(stepMinutes) : 1;

/** Slots in a day at this resolution. Ceil so the day's tail minutes still land. */
export function slotCount(stepMinutes: number): number {
  return Math.ceil(1440 / normalizeStep(stepMinutes));
}

/** The slot containing this local wall-clock time. */
export function slotIndexAt(stepMinutes: number, hours: number, minutes: number): number {
  return Math.floor((hours * 60 + minutes) / normalizeStep(stepMinutes));
}

/** A slot's start time as `HH:MM`. */
export function slotLabelAt(stepMinutes: number, index: number): string {
  const t = index * normalizeStep(stepMinutes);
  const hh = String(Math.floor(t / 60)).padStart(2, "0");
  const mm = String(t % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

const emptyColumn = (n: number): (number | null)[] => Array.from({ length: n }, () => null);

/** A real, usable reading — excludes null, undefined and NaN alike. */
const isReading = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Running mean and peak for one slot, before it collapses to a reading or null. */
interface SlotAcc {
  sum: number;
  count: number;
  peak: number | null;
}

/** Fold one rollup into its slot's running mean and peak. */
function accumulate(a: SlotAcc, row: MinuteRollup): void {
  if (isReading(row.avg)) {
    a.sum += row.avg;
    a.count += 1;
  }
  if (isReading(row.max)) a.peak = a.peak === null ? row.max : Math.max(a.peak, row.max);
}

/** The accumulator for a row's slot, or undefined if it has no place on the grid. */
function slotFor(acc: SlotAcc[], row: MinuteRollup, stepMinutes: number): SlotAcc | undefined {
  const d = new Date(row.time);
  // A row whose timestamp does not parse is dropped: one bad row must not
  // blank a slot that has good data.
  if (Number.isNaN(d.getTime())) return undefined;
  // An out-of-range index simply misses the array.
  return acc[slotIndexAt(stepMinutes, d.getHours(), d.getMinutes())];
}

/**
 * Bucket minute rollups into each slot's mean and peak W.
 *
 * A slot receives a number only if at least one minute landed in it; otherwise
 * it stays null, because nobody measured it.
 */
export function measuredFromRollups(rows: MinuteRollup[], stepMinutes: number): MeasuredDay {
  const n = slotCount(stepMinutes);
  const acc: SlotAcc[] = Array.from({ length: n }, () => ({ sum: 0, count: 0, peak: null }));

  for (const row of rows) {
    const a = slotFor(acc, row, stepMinutes);
    if (a) accumulate(a, row);
  }

  return {
    avgW: acc.map((a) => (a.count > 0 ? a.sum / a.count : null)),
    peakW: acc.map((a) => a.peak),
  };
}

/**
 * Fallback for profiles exposing no `pv.total.power` role: spread each hour's
 * energy across that hour's slots as an average W.
 *
 * Hours after the current one are left unmeasured so the rest of the day stays
 * forecast-only — but the *current* hour is filled completely. Energy the
 * server already attributed to this hour has been produced; truncating the fill
 * at the running slot silently dropped up to an hour of production from the
 * headline every time the dialog was opened mid-hour. No peaks exist on this
 * path.
 */
export function measuredFromHourlyEnergy(
  rows: HourlyEnergy[],
  stepMinutes: number,
  nowIndex: number,
): MeasuredDay {
  const n = slotCount(stepMinutes);
  const avgW = emptyColumn(n);
  const span = { step: normalizeStep(stepMinutes), slots: n, nowIndex };

  for (const row of rows) fillHour(avgW, row, span);

  return { avgW, peakW: emptyColumn(n) };
}

/** The hour a period key names, or null if it does not name one. */
function hourOf(bucket: string): number | null {
  const hour = Number(bucket.slice(11, 13));
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

/** Grid geometry one hour is painted onto. */
interface HourSpan {
  step: number;
  slots: number;
  nowIndex: number;
}

/**
 * Paint one hour's energy across its elapsed slots as an average W.
 *
 * The in-progress hour reports the energy produced *so far*, so it is averaged
 * over the slots that have actually elapsed — not the whole hour. Spreading it
 * across all four quarters and then integrating only the elapsed ones dropped
 * most of the current hour from the headline.
 */
function fillHour(avgW: (number | null)[], row: HourlyEnergy, span: HourSpan): void {
  const hour = hourOf(row.bucket);
  if (hour === null || !isReading(row.productionKwh)) return;

  const slotsPerHour = Math.max(1, Math.round(60 / span.step));
  const first = slotIndexAt(span.step, hour, 0);
  // Clamped to "now", so an hour that has not begun yields last < first.
  const last = Math.min(first + slotsPerHour - 1, span.nowIndex, span.slots - 1);
  if (last < first) return;

  const watts = (row.productionKwh * 1000 * 60) / (span.step * (last - first + 1));
  for (let i = first; i <= last; i++) avgW[i] = watts;
}

/**
 * Integrate the measured column into kWh, alongside the coverage behind it.
 *
 * `nowIndex` bounds the window that *could* have been measured; slots after it
 * are the future, not an outage. Omit it to treat the whole day as the window.
 */
export function measuredTotal(
  day: MeasuredDay,
  stepMinutes: number,
  nowIndex?: number,
): MeasuredTotal {
  const n = slotCount(stepMinutes);
  const step = normalizeStep(stepMinutes);
  const elapsedSlots =
    nowIndex === undefined ? n : Math.max(0, Math.min(n, Math.floor(nowIndex) + 1));

  let kwh = 0;
  let coveredSlots = 0;
  for (let i = 0; i < elapsedSlots; i++) {
    const w = day.avgW[i];
    // null is "not measured", not "measured zero" — it must not be integrated.
    if (!isReading(w)) continue;
    coveredSlots += 1;
    kwh += (w * step) / 60 / 1000;
  }

  return {
    kwh,
    coveredSlots,
    elapsedSlots,
    complete: elapsedSlots > 0 && coveredSlots === elapsedSlots,
  };
}
