/**
 * Decision log — the short rolling history the automations UI charts.
 *
 * One point per *steering* tick (live or shadow), holding the raw ingredients a
 * chart needs rather than anything pre-derived: what the plant was doing, what
 * the automation decided, and what the battery/grid actually did with it. That
 * keeps the client free to plot planned-vs-measured without the server guessing
 * which comparison matters.
 *
 * Deliberately **in memory only**: a ring buffer, no schema, no retention
 * policy, gone on restart. Its job is "watch what shadow mode would do for a
 * while", not long-horizon analytics — the metrics hypertable already covers
 * that. The API shape is stable enough that a persistent backing store can be
 * swapped in later without touching the client.
 */

/** One tick's decision plus the live readings it was made from. */
export interface DecisionPoint {
  /** Tick time, epoch ms. */
  t: number;
  /** True when the tick only simulated — nothing was written. */
  shadow: boolean;
  pvW: number;
  /** House load the decision used, W; null when the plant offers none. */
  loadW: number | null;
  /** Live EV draw, W; null when EVCC is off or unreachable. */
  evChargeW: number | null;
  /** PV that can never reach the grid (load + EV when not already in it), W. */
  localSinkW: number;
  /** The shave threshold applied this tick, W. */
  thresholdW: number;
  /** Charge-current target the decision landed on, A. */
  targetA: number;
  /** Register value read *before* this tick's write, A; null when unreadable. */
  liveA: number | null;
  /** Battery voltage used for the W→A conversion, V. */
  batteryV: number;
  /** Measured charge power, W; null when `battery.power` is unmapped. */
  chargeW: number | null;
  /** Measured grid export, W; null when `grid.power` is unmapped. */
  exportW: number | null;
  socPct: number;
}

/**
 * Ring capacity: 24 h at the 30 s tick cadence. ~2.9k small objects — cheap
 * enough to keep resident, long enough to cover a full solar day.
 */
export const HISTORY_CAPACITY = 2_880;

export interface DecisionLog {
  push(point: DecisionPoint): void;
  /** Oldest → newest. A copy, so callers can't mutate the ring. */
  points(): DecisionPoint[];
}

/** A fixed-capacity ring that drops the oldest point once full. */
export function createDecisionLog(capacity: number = HISTORY_CAPACITY): DecisionLog {
  const buffer: DecisionPoint[] = [];
  let next = 0;
  return {
    push(point) {
      if (buffer.length < capacity) buffer.push(point);
      else buffer[next] = point;
      next = (next + 1) % capacity;
    },
    points() {
      // Below capacity the ring is still in insertion order; once it wraps,
      // `next` marks the oldest slot.
      if (buffer.length < capacity) return [...buffer];
      return [...buffer.slice(next), ...buffer.slice(0, next)];
    },
  };
}
