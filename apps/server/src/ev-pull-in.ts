/**
 * Borrowing the car as a sink for a negative-price window.
 *
 * This is not a garnish on the battery envelope — it is what makes the envelope
 * physically achievable. Taking a 15 kWh pack from 62 % to 10 % in the three
 * hours before a window needs ~7.8 kWh of sink; a 400 W house supplies 1.2 kWh
 * of it. Withholding charge cannot close that gap. A car that wants energy
 * anyway can.
 *
 * Pure: it decides *which* loadpoints to claim and release, and the engine does
 * the publishing. So the rules are unit-testable without a broker.
 */

import type { EvccLoadpoint, EvccState } from "./evcc";
import type { PriceRegime } from "./price-plan";

/** The charge mode a claimed loadpoint is switched to. */
export const PULL_IN_MODE = "now";

export interface EvPullInInputs {
  /** Whether the user opted into commanding the charger at all. */
  enabled: boolean;
  regime: PriceRegime;
  evcc: EvccState | null;
  /** Loadpoints whose mode this automation currently holds. */
  heldLoadpoints: readonly number[];
}

export interface EvPullInPlan {
  /** Loadpoints to switch to {@link PULL_IN_MODE}, with the mode to remember. */
  claim: { loadpoint: number; previousMode: string }[];
  /** Loadpoints to hand back. */
  release: number[];
}

/**
 * Whether the car is worth claiming right now.
 *
 * Only in the two regimes where a sink is what is actually wanted:
 * - `absorb` — inside the window, the car soaks energy that would earn nothing.
 * - `spend-down` — the pack is already fuller than the window needs, and the car
 *   is the only sink that can empty it in time.
 *
 * Deliberately *not* during `pre-shape`: there the envelope is coping on its
 * own, and overriding the user's charge plan to solve a problem that isn't
 * happening would be a bad trade.
 */
const wantsSink = (regime: PriceRegime): boolean => regime === "absorb" || regime === "spend-down";

/**
 * Whether this loadpoint can usefully take energy: a car is plugged in, it is
 * not already finished, and EVCC is not deliberately switched off for it by us.
 */
function usable(lp: EvccLoadpoint): boolean {
  if (!lp.connected) return false;
  const soc = lp.vehicleSoc;
  const limit = lp.effectiveLimitSoc;
  // Unknown SOC or limit: assume the car still wants energy rather than refusing
  // to help — the worst case is EVCC declining to charge, which costs nothing.
  if (soc === null || limit === null) return true;
  return soc < limit;
}

/**
 * Which loadpoints to claim and which to hand back.
 *
 * Claiming is idempotent: a loadpoint already held is not re-claimed, so the
 * remembered mode stays the user's original rather than being overwritten with
 * our own `now` on the next tick.
 */
export function planEvPullIn(i: EvPullInInputs): EvPullInPlan {
  const loadpoints = i.evcc?.reachable ? i.evcc.loadpoints : [];
  const held = new Set(i.heldLoadpoints);
  // Anything we hold but no longer want (or can no longer see) goes back.
  if (!i.enabled || !wantsSink(i.regime)) {
    return { claim: [], release: [...held] };
  }

  const claim: EvPullInPlan["claim"] = [];
  const wanted = new Set<number>();
  for (const lp of loadpoints) {
    if (!usable(lp)) continue;
    wanted.add(lp.index);
    if (held.has(lp.index)) continue;
    // A loadpoint with no reported mode is still claimable; `off` is the safe
    // thing to hand back, since that is what "we never saw a mode" degrades to.
    claim.push({ loadpoint: lp.index, previousMode: lp.mode ?? "off" });
  }
  return { claim, release: [...held].filter((lp) => !wanted.has(lp)) };
}
