/**
 * EVCC wire shapes shared by the server and the web app.
 *
 * These are the definition site: the server's `evcc/` modules import them
 * back, and the web EVCC store imports them from `@SunReye/contracts/evcc`.
 * Type-only — no runtime tail (see AGENTS.md).
 */

/** Where a loadpoint's live charge-power figure comes from (freshness/confidence hint). */
export type ChargePowerSource = "measured" | "estimated" | "feedforward";

/** The per-loadpoint fields the web app renders (subset of EVCC's topics). */
export interface EvccLoadpoint {
  /** 1-based loadpoint index, as used in EVCC's topics. */
  index: number;
  /** Loadpoint label from the EVCC config (e.g. "Carport"). */
  title: string | null;
  /** Charge mode: `off` | `pv` | `minpv` | `now`. */
  mode: string | null;
  /** Current charge power in W, as last reported by EVCC. */
  chargePower: number;
  /**
   * Live charge power in W — the estimator's view, updated between EVCC's
   * publishes from command feed-forward and the 1 Hz house-load residual.
   * Equals {@link chargePower} whenever the last word was EVCC's own.
   */
  chargePowerLive: number;
  /** Provenance of {@link chargePowerLive} (freshness/confidence hint). */
  chargePowerSource: ChargePowerSource;
  charging: boolean;
  /** Vehicle plugged in. */
  connected: boolean;
  vehicleSoc: number | null;
  /** Vehicle range in km. */
  vehicleRange: number | null;
  /** Display name of the detected vehicle (nicer than the config slug). */
  vehicleTitle: string | null;
  /**
   * Config slug of the detected vehicle (`tesla_ble`) — the key under
   * `<root>/vehicles/`. Carried for the limit write path, which targets the
   * vehicle rather than the loadpoint; prefer {@link vehicleTitle} for display.
   */
  vehicleName: string | null;
  /** Energy added this charging session in Wh. */
  sessionEnergy: number | null;
  /** Energy still needed to reach the charge limit in Wh (EVCC's estimate). */
  chargeRemainingEnergy: number | null;
  /**
   * The loadpoint's *session* charge limit in %, EVCC's per-session override of
   * the vehicle's configured limit. `0` means "no override", **not** "no limit",
   * and EVCC clears it on unplug or restart — so it is never the value to
   * display on its own. See {@link effectiveLimitSoc}.
   */
  limitSoc: number | null;
  /**
   * The limit EVCC actually charges to, in % — its own resolution of the
   * session override and the vehicle's configured limit. This is what EVCC's UI
   * shows, so it is what the dashboard renders. `0`/null = no limit.
   */
  effectiveLimitSoc: number | null;
  /**
   * Charge limit read *from the car* in %, informational only: EVCC surfaces it
   * so a taper it does not control can be explained. Not writable, and not part
   * of the effective-limit resolution.
   */
  vehicleLimitSoc: number | null;
  /**
   * Battery boost: EVCC is deliberately draining the *house* battery into this
   * car. Transient — EVCC keeps it in memory only and clears it on any mode
   * change and on unplug, so there is no durable value to give back.
   *
   * EVCC refuses to enable it outside the `pv`/`minpv` modes.
   */
  batteryBoost: boolean;
  /**
   * House-battery SOC floor for {@link batteryBoost}, %: once the battery falls
   * below it EVCC stops draining but keeps the car prioritised over recharging,
   * so it settles at the limit instead of oscillating. `100` means *disabled*,
   * which is also EVCC's default. Unlike the boost flag this **is** persisted by
   * EVCC, so anything that changes it owes the user a restore.
   */
  batteryBoostLimit: number | null;
  /**
   * Usable pack size of the detected vehicle in kWh, from
   * `<root>/vehicles/<name>/capacity`. Null when no vehicle is detected, or
   * when EVCC has none configured for it (published as `0`) — a car without a
   * capacity is one nothing can be estimated for. Carried on the loadpoint
   * because that is where the SoC and the limit already are, and the three are
   * only useful together.
   */
  vehicleCapacityKwh: number | null;
  phasesActive: number | null;
}

export interface EvccState {
  /** Broker connected *and* EVCC's own status topic reports online. */
  reachable: boolean;
  loadpoints: EvccLoadpoint[];
  /**
   * Diagram hint: subtract the EV from the house-load node. Carried here (not in
   * the admin-only settings) so the session-scoped public dashboard can read it.
   */
  subtractFromHome: boolean;
}
