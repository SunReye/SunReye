/**
 * THE OPTIMIZER'S STORED VOCABULARIES — one definition, both sides of the wire.
 *
 * `optimizer.state`, `optimizer.price.regime` and `optimizer.mode` are stored as
 * INTEGERS: `metrics_raw` holds an int for five years and these arrays are the
 * only thing that can say what it meant. FROZEN BY POSITION — append at the end,
 * never insert, never reorder, the same rule an enum column in any database
 * follows.
 *
 * WHY HERE, AND NOT ONCE PER APP
 *
 * The server writes the ordinal (`apps/server/src/automation/optimizer-device.ts`)
 * and the web chart reads it back (`$lib/components/automations/decision-series.ts`).
 * They were two hand-kept copies of one frozen list, with nothing tying them
 * together: inserting a state on the server would have left the chart labelling
 * every `shadow` bucket as `simulating` — for five years of stored rows, silently,
 * which is the precise failure "frozen by position" exists to prevent.
 *
 * `@SunReye/inverter-core` is the one value-carrying package BOTH zones may
 * import (`.fallowrc.json`: `web → inverter-core`, `server → inverter-core`);
 * `@SunReye/contracts`, the other shared home, is type-only by invariant and
 * cannot hold a `const` at all. So the list lives beside `ROLE_CATALOG`, which
 * already declares `optimizer.state` as an enum needing labels — and a divergence
 * is not caught by a test, it is unrepresentable.
 */

/** The run states, as the integers stored under `optimizer.state`. */
export const OPTIMIZER_RUN_STATES = [
  "disabled",
  "blocked",
  "idle",
  /** Steering the register. */
  "active",
  /** Deciding and logging, but writing nothing (`shadowMode`). */
  "shadow",
  /** Switched off, but a runnable setup still decides in dry-run each tick. */
  "simulating",
  "stale",
] as const;

/** The price regimes, as the integers stored under `optimizer.price.regime`. */
export const OPTIMIZER_PRICE_REGIMES = [
  "none",
  "waiting",
  "pre-shape",
  "spend-down",
  "absorb",
] as const;

/** The modes, as the integers stored under `optimizer.mode`. */
export const OPTIMIZER_MODES = ["maximize-exports", "grid-friendly"] as const;
