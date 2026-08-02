/**
 * Borrowing the car as a sink for a negative-price window.
 *
 * This is not a garnish on the battery envelope — it is what makes the envelope
 * physically achievable. Taking a 15 kWh pack from 62 % to 10 % in the three
 * hours before a window needs ~7.8 kWh of sink; a 400 W house supplies 1.2 kWh
 * of it. Withholding charge cannot close that gap. A car that wants energy
 * anyway can.
 *
 * ## Two levers, not one
 *
 * The pack is emptied with EVCC's **battery boost**, which exists for exactly
 * this: it pushes the loadpoint to draw from the house battery, and stops at a
 * configured house-battery SOC — {@link EvPullInInputs.boostLimitPct} — holding
 * there rather than oscillating. Boost is used only while the pack is still too
 * full ({@link PriceRegime} `spend-down`); once the window starts the pack
 * should be *filling* with energy that would otherwise earn nothing, so
 * draining it into the car would be a round trip for no gain.
 *
 * The other lever is milder: an idle charger is woken onto `pv` so it soaks
 * surplus during the window. A charger already in a PV mode is left alone —
 * EVCC's own surplus logic is already doing the right thing — and one in `now`
 * is never touched at all: it is charging as hard as it can already, and EVCC
 * refuses battery boost outside the PV modes anyway.
 *
 * ## Convergence, not commands
 *
 * The plan describes the *desired* state of each loadpoint and emits only the
 * fields that differ from what EVCC currently reports, so re-running it on an
 * already-correct charger produces nothing. That is what makes a 30-second tick
 * safe to point at someone's charger, and it is what recovers from a boost EVCC
 * rejected because our mode command had not landed yet.
 *
 * Pure: it decides *what* each loadpoint should look like, and the engine does
 * the publishing. So the rules are unit-testable without a broker.
 */

import type { EvccLoadpoint, EvccState } from "./evcc";
import { chargeStopSoc } from "./peak-shaving";
import type { PriceRegime } from "./price-plan";

/** The charge mode an idle loadpoint is woken into. */
const SINK_MODE = "pv";

/** EVCC's own "boost disabled" value for the boost SOC limit. */
export const BOOST_LIMIT_DISABLED = 100;

export interface EvPullInInputs {
  /** Whether the user opted into commanding the charger at all. */
  enabled: boolean;
  regime: PriceRegime;
  evcc: EvccState | null;
  /** House-battery SOC the car may drain the pack down to while boosting, %. */
  boostLimitPct: number;
  /** Loadpoints this automation currently holds. */
  heldLoadpoints: readonly number[];
}

/** The commands one loadpoint needs to reach its desired state. */
export interface EvPullInClaim {
  loadpoint: number;
  /** Mode to publish, or null to leave the user's. Published *first*. */
  mode: string | null;
  /** Boost SOC limit to publish, or null to leave EVCC's. */
  boostLimitPct: number | null;
  /** Boost flag to publish, or null to leave it. Published *last*. */
  boost: boolean | null;
  /** What to remember for the hand-back; null once already held. */
  remember: { mode: string; boostLimitPct: number } | null;
}

export interface EvPullInRelease {
  loadpoint: number;
  /**
   * Whether to hand the charge mode back too.
   *
   * False when the loadpoint is no longer in the mode this automation put it in:
   * someone has taken it over since, and their choice is fresher than our
   * snapshot. What EVCC *persists* is handed back either way.
   */
  restoreMode: boolean;
}

export interface EvPullInPlan {
  claim: EvPullInClaim[];
  /** Loadpoints to hand back. */
  release: EvPullInRelease[];
}

/**
 * Whether the car is worth borrowing right now.
 *
 * Only in the two regimes where a sink is what is actually wanted:
 * - `absorb` — inside the window, the car soaks energy that would earn nothing.
 * - `spend-down` — the pack is already fuller than the window needs, and the car
 *   is the only sink that can empty it in time.
 *
 * Deliberately *not* during `pre-shape`: there the envelope is coping on its
 * own, and reaching into the user's charger to solve a problem that isn't
 * happening would be a bad trade.
 */
const wantsSink = (regime: PriceRegime): boolean => regime === "absorb" || regime === "spend-down";

/**
 * Whether this loadpoint can usefully take energy: a car is plugged in, it is
 * not already finished, and it is not in a mode there is nothing to add to.
 */
function usable(lp: EvccLoadpoint): boolean {
  // `now` is already charging flat out and cannot boost — nothing to gain, and
  // slowing it to `pv` would be taking away what the user asked for.
  if (!lp.connected || lp.mode === "now") return false;
  const soc = lp.vehicleSoc;
  const limit = chargeStopSoc(lp);
  // Unknown SOC or limit: assume the car still wants energy rather than refusing
  // to help — the worst case is EVCC declining to charge, which costs nothing.
  if (soc === null || limit === null) return true;
  return soc < limit;
}

/** The mode to put this loadpoint in: idle chargers are woken, PV ones left alone. */
const wakeMode = (lp: EvccLoadpoint): string | null =>
  lp.mode === SINK_MODE || lp.mode === "minpv" ? null : SINK_MODE;

/** What to hand back later, with EVCC's own defaults standing in for gaps. */
const originals = (lp: EvccLoadpoint): { mode: string; boostLimitPct: number } => ({
  mode: lp.mode ?? "off",
  boostLimitPct: lp.batteryBoostLimit ?? BOOST_LIMIT_DISABLED,
});

/** What all three settings should look like for this loadpoint. */
function desired(lp: EvccLoadpoint, i: EvPullInInputs) {
  // Boost only ever empties the pack, so it belongs to `spend-down` alone —
  // inside the window the pack should be filling instead. `usable` has already
  // dropped the one mode EVCC would refuse boost in, and the mode command is
  // published first, so a boost rejected by a stale mode is re-issued next tick.
  const boost = i.regime === "spend-down";
  return { mode: wakeMode(lp), boost, boostLimitPct: boost ? i.boostLimitPct : null };
}

/** The value to publish when EVCC reports something else, else null. */
const differing = <T>(want: T, have: T | null): T | null => (want === have ? null : want);

/** The commands this loadpoint still needs, or null when it already agrees. */
function claimFor(lp: EvccLoadpoint, i: EvPullInInputs, held: boolean): EvPullInClaim | null {
  const want = desired(lp, i);
  const claim: EvPullInClaim = {
    loadpoint: lp.index,
    mode: differing(want.mode, lp.mode),
    boostLimitPct: differing(want.boostLimitPct, lp.batteryBoostLimit),
    boost: differing(want.boost, lp.batteryBoost),
    remember: held ? null : originals(lp),
  };
  const quiet = claim.mode === null && claim.boostLimitPct === null && claim.boost === null;
  return quiet ? null : claim;
}

/**
 * What to command and what to hand back.
 *
 * A loadpoint already in its desired state produces no commands, so the
 * remembered values stay the user's originals rather than being overwritten with
 * our own on the next tick.
 */
export function planEvPullIn(i: EvPullInInputs): EvPullInPlan {
  const loadpoints = i.evcc?.reachable ? i.evcc.loadpoints : [];
  const held = new Set(i.heldLoadpoints);
  // Anything we hold but no longer want (or can no longer see) goes back. An
  // invisible loadpoint gets the full hand-back attempted: the command throws
  // while the broker is down, which keeps it held for the next tick.
  const handBack = (keep: ReadonlySet<number>): EvPullInRelease[] =>
    [...held]
      .filter((lp) => !keep.has(lp))
      .map((loadpoint) => {
        const lp = loadpoints.find((l) => l.index === loadpoint);
        return { loadpoint, restoreMode: lp === undefined || lp.mode === SINK_MODE };
      });

  if (!i.enabled || !wantsSink(i.regime)) return { claim: [], release: handBack(new Set()) };

  const claim: EvPullInClaim[] = [];
  const wanted = new Set<number>();
  for (const lp of loadpoints) {
    if (!usable(lp)) continue;
    wanted.add(lp.index);
    const next = claimFor(lp, i, held.has(lp.index));
    if (next) claim.push(next);
  }
  return { claim, release: handBack(wanted) };
}
