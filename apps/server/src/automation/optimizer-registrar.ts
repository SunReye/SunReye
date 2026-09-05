/**
 * The optimizer's decisions -> its registered device -> `metrics_raw`.
 *
 * ONE WRITER, NOT A SECOND ONE
 *
 * Every value here goes through the runtime's `commit` seam (#175) — the same
 * `createDeviceWriter` the poll loop and the EVCC registrar use, feeding the
 * same two history buffers on the same flush cadence. A second writer here would
 * mean a second identity resolver, a second buffer pair with its own cap and
 * drop policy, and two buffering regimes writing into the same two tables. The
 * ring this replaces was exactly that: a private store with its own capacity,
 * its own retention (none) and its own reader.
 *
 * WHY A REGISTRAR AT ALL, RATHER THAN A LINE IN `./automation.ts`
 *
 * Because `metrics_raw.device_id` is a NOT NULL foreign key and the write path
 * DROPS rows naming a device with no row rather than failing a 100 000-row
 * batch: a commit that beats its row loses decisions and says so only in a log
 * line. So the row comes first, the roster reload comes second, and both have to
 * happen at most once for a device that is working — the engine ticks every
 * 30 s, and re-reading the device table on each of those is 2 880 queries a day
 * for an answer that has not changed since boot.
 *
 * Which means remembering the ATTEMPT, not just the successes. A row that exists
 * and never resolves — the operator retired the optimizer in Settings → Devices,
 * or a registry reload failed — would otherwise be ensured, and reloaded for,
 * forever. That is the defect the EVCC registrar was fixed for; this one is born
 * with it fixed. The attempt is recorded for a `ensureDevice` that THREW too:
 * an unreachable device table is the failure that most needs the cadence, and
 * remembering only the calls that returned left that one path ungated.
 *
 * WHAT IT DOES NOT NEED, AND EVCC'S DOES
 *
 * A roster. There is exactly one optimizer per plant, it never renumbers and it
 * never vanishes mid-run, so there is nothing to diff and nothing to retire:
 * `forgetDevice` has no caller here. `suspend` exists for the same reason
 * EVCC's does — a stopped engine is not a retirement, and the next start
 * re-registers immediately rather than waiting out a retry interval.
 */

import type { PeakShavingStatus } from "@SunReye/contracts/automation";
import type { DeviceInstance } from "@SunReye/inverter-core";

import type { DeviceSample } from "../inverter/device-writer";
import { optimizerSample } from "./optimizer-device";

/** The failure paths this logs; kept minimal so any logger satisfies it. */
export interface RegistrarLogger {
  warn(template: string, values?: Record<string, unknown>): void;
}

/**
 * What the `devices` table holds for the optimizer once
 * {@link OptimizerRegistrarDeps.ensureDevice} has had its turn.
 *
 * Three answers rather than a boolean, because "the row is there" and "the row
 * is there and the registry will resolve it" are different facts and only the
 * second one leads to a reload: `ensureDevice` is `ON CONFLICT DO NOTHING` +
 * SELECT and answers for a RETIRED row too, while the roster read excludes
 * exactly those rows.
 */
export type DeviceRowState =
  /** The row exists and is active: reload, and the registry will resolve it. */
  | "ready"
  /** The row exists but the operator retired it. Nothing to store; say so. */
  | "retired"
  /** No plant to hang a device on yet — an onboarding-only boot. */
  | "absent";

export interface OptimizerRegistrarDeps {
  /** Create the optimizer's `devices` row if absent, and say what the table holds. */
  ensureDevice(): Promise<DeviceRowState>;
  /** Re-read the plant's roster, so the new row becomes a `DeviceInstance`. */
  reloadRegistry(): Promise<void>;
  /** The registered instance, or undefined while the roster lags. */
  device(): DeviceInstance | undefined;
  /** The runtime's write seam — the ONE wired writer. */
  commit(device: DeviceInstance, sample: DeviceSample): void;
  logger: RegistrarLogger;
}

export interface OptimizerRegistrar {
  /** Register if needed, then store this tick's decision. Never throws. */
  record(status: PeakShavingStatus, localSinkW: number, at: Date): Promise<void>;
  /**
   * Forget the registration WITHOUT retiring the device — the teardown path
   * (`stopAutomations`, a config save that rebuilds the engine). The optimizer
   * has not gone anywhere, so its row, its history and its open intervals stay
   * exactly as they are and the next tick re-registers.
   */
  suspend(): void;
}

/**
 * How long a failed registration waits before the row is ensured again.
 *
 * A cadence rather than "only on a change", deliberately: every state that needs
 * retrying heals without anything the engine can see — the operator finishes
 * onboarding, or restores the device in Settings → Devices. Ten minutes is
 * 20 ticks at the 30 s cadence, so a misconfigured plant that has already said
 * so in the log costs one query per ten minutes.
 */
const RETRY_INTERVAL_MS = 10 * 60_000;

/**
 * Build a registrar. Every field is closure-local, so a second instance shares
 * nothing — the same rule the runtime, the registry and the writer follow.
 */
export function createOptimizerRegistrar(deps: OptimizerRegistrarDeps): OptimizerRegistrar {
  /** True once the row exists AND the registry resolved it. */
  let registered = false;
  /**
   * When the last `ensureDevice` ran, and what it answered — `"failed"` when it
   * answered nothing at all because it threw.
   *
   * A throw is a state that needs the gate MOST: an unreachable database is the
   * one failure that heals without the engine seeing anything, and re-ensuring on
   * every tick is 2 880 failing round trips a day against a database already in
   * trouble.
   */
  let attempt: { at: number; state: DeviceRowState | "failed" } | null = null;
  /** Situations already reported, so each is said once rather than every tick. */
  const reported = new Set<string>();
  /** So a device table that cannot be reached is reported once, not per tick. */
  let registrationWarned = false;
  /**
   * A record is already inside its device round trip. The engine awaits each
   * tick, so this only fires when a config save hot-applies a tick beside the
   * timer's — and both would otherwise ensure and reload the same row.
   */
  let registering = false;

  function reportOnce(key: string, say: () => void): void {
    if (reported.has(key)) return;
    reported.add(key);
    say();
  }

  /**
   * Ensure the row and reload the roster if that produced anything new.
   *
   * A `retired` answer deliberately does NOT reload: the roster read excludes
   * retired rows, so re-reading it could not change the answer, and doing it
   * anyway is the query storm this remembers attempts to avoid.
   */
  async function ensureRegistered(at: Date): Promise<void> {
    if (registered || registering) return;
    if (attempt && at.getTime() - attempt.at < RETRY_INTERVAL_MS) return;
    registering = true;
    // Recorded BEFORE the call, not after it: an `await` that throws never
    // reaches the assignment below, and an attempt that is only remembered when
    // it succeeded is not a retry gate at all.
    attempt = { at: at.getTime(), state: "failed" };
    try {
      const state = await deps.ensureDevice();
      attempt = { at: at.getTime(), state };
      if (state === "ready") await deps.reloadRegistry();
      // Cleared on success rather than latched for the life of the process: a
      // failure that heals must be re-reportable, or the SECOND, different
      // failure is silent.
      registrationWarned = false;
    } catch (error) {
      reportRegistrationFailure(error);
    } finally {
      registering = false;
    }
  }

  /** Say once that the device table could not be reached. */
  function reportRegistrationFailure(error: unknown): void {
    if (registrationWarned) return;
    registrationWarned = true;
    deps.logger.warn(
      "could not register the optimizer as a device: {error} — it keeps steering the plant, but its decisions are not being stored",
      { error: error instanceof Error ? error.message : String(error) },
    );
  }

  /** Say out loud, once, that the optimizer's decisions are going nowhere. */
  function reportUnstored(): void {
    if (attempt?.state === "retired") {
      reportOnce("retired", () =>
        deps.logger.warn(
          "the optimizer's device is retired — it keeps steering the plant, but nothing it " +
            "decides is being stored. Restore the device in Settings → Devices to resume its history.",
        ),
      );
      return;
    }
    if (attempt?.state === "ready") {
      reportOnce("unresolved", () =>
        deps.logger.warn(
          "the optimizer has a device row but the plant's roster did not resolve it — nothing " +
            "it decides is being stored. Retrying every few minutes.",
        ),
      );
    }
  }

  return {
    async record(status, localSinkW, at) {
      await ensureRegistered(at);
      const device = deps.device();
      if (!device) {
        // Rule 1, as a belt over the ordering above: a device the registry has
        // not resolved has no metric list, and committing to it would route
        // undeclared keys through a policy built from nothing.
        reportUnstored();
        return;
      }
      registered = true;
      // Resolved is the end of every situation worth reporting.
      reported.clear();
      deps.commit(device, optimizerSample(status, localSinkW, at));
    },
    suspend() {
      registered = false;
      attempt = null;
      registrationWarned = false;
      reported.clear();
    },
  };
}
