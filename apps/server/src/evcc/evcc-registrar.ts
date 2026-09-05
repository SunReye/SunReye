/**
 * EVCC's live snapshot -> registered devices -> `metrics_raw`.
 *
 * THE CONCRETE WIN OF STEP 8
 *
 * Nothing under `apps/server/src/evcc/` wrote to `metrics_raw` before this file.
 * Charge power and session energy were live-feed only: a WebSocket topic, a card
 * on the dashboard, and no history, no rollups and no statistics — the plant's
 * biggest single load was the one thing it could not chart yesterday.
 *
 * ONE WRITER, NOT A SECOND ONE
 *
 * Every reading here goes through the runtime's `commit` seam (#175), which is
 * the same `createDeviceWriter` the poll loop uses, feeding the same two history
 * buffers on the same flush cadence. Standing up a second writer here would mean
 * a second identity resolver, a second buffer pair with its own cap and its own
 * drop policy, and two buffering regimes writing into the same two tables.
 *
 * WHY A REGISTRAR AT ALL, RATHER THAN A LINE IN `./evcc.ts`
 *
 * Because the lifecycle has three rules and each is a way to lose data:
 *
 *  1. THE ROW BEFORE THE COMMIT. `metrics_raw.device_id` is a NOT NULL foreign
 *     key, and the write path DROPS rows naming a device with no row rather than
 *     failing a 100 000-row batch. A commit that beat its row loses readings and
 *     says so only in a log line.
 *  2. ONE RELOAD PER ROSTER CHANGE. The registry re-reads the plant's device
 *     table; doing that on every coalesced snapshot would be a query per 200 ms.
 *     Which means remembering the ATTEMPT, not just the successes: a row that
 *     exists and never resolves (an operator retiring the device does exactly
 *     that) would otherwise be ensured — and reloaded for — forever.
 *  3. A VANISHED LOADPOINT IS RETIRED, NOT DROPPED. Its readings up to that
 *     moment are history and must be written out — `forgetDevice` closes what it
 *     held open — and nothing after it may be keyed to it.
 *
 * Each of those is testable against doubles, and none of them is a statement
 * about Postgres. The statement about Postgres is
 * `apps/server/db-tests/evcc-loadpoint-history.test.ts`.
 */

import type { EvccLoadpoint } from "@SunReye/contracts/evcc";
import type { DeviceInstance } from "@SunReye/inverter-core";

import type { DeviceSample } from "../inverter/device-writer";
import { loadpointDeviceId, loadpointSample, retiredLoadpoints } from "./evcc-devices";

/** The failure paths this logs; kept minimal so any logger satisfies it. */
export interface RegistrarLogger {
  warn(template: string, values?: Record<string, unknown>): void;
}

/**
 * What the `devices` table holds for a loadpoint once {@link
 * LoadpointRegistrarDeps.ensureDevice} has had its turn.
 *
 * Three answers rather than a boolean, because "the row is there" and "the row
 * is there and the registry will resolve it" are different facts and only the
 * second one leads to a reload. `ON CONFLICT DO NOTHING` + SELECT answers the
 * first for a RETIRED row too, while the roster read excludes retired rows — so
 * a boolean made an operator retiring the device indistinguishable from a
 * healthy registration, and the registrar re-ensured and re-reloaded for it on
 * every snapshot, forever.
 */
export type DeviceRowState =
  /** The row exists and is active: reload, and the registry will resolve it. */
  | "ready"
  /** The row exists but the operator retired it. Nothing to store; say so. */
  | "retired"
  /** No plant to hang a device on yet — an onboarding-only boot. */
  | "absent";

export interface LoadpointRegistrarDeps {
  /**
   * Create the loadpoint's `devices` row if it is not already there, and answer
   * what the table now holds for it. `"absent"` is a legal answer: EVCC ingest
   * starts even in an onboarding-only boot, where there is no plant yet.
   */
  ensureDevice(id: string, index: number, title: string | null): Promise<DeviceRowState>;
  /** Re-read the plant's roster, so a new row becomes a `DeviceInstance`. */
  reloadRegistry(): Promise<void>;
  /** The registered instance for an id, or undefined while the roster lags. */
  device(id: string): DeviceInstance | undefined;
  /** The runtime's write seam — the ONE wired writer. */
  commit(device: DeviceInstance, sample: DeviceSample): void;
  /** The runtime's retire seam: write out what a device held open, then drop it. */
  forgetDevice(id: string): void;
  logger: RegistrarLogger;
}

export interface LoadpointRegistrar {
  /** Register what is new, store every loadpoint's readings, retire what is gone. */
  sync(loadpoints: readonly EvccLoadpoint[], at: Date): Promise<void>;
  /**
   * Forget which devices are registered WITHOUT retiring them.
   *
   * The teardown path (`stopEvcc`, a settings save that rebuilds the client).
   * The loadpoints have not gone anywhere — the subscription has — so their
   * devices keep their rows, their history and their open intervals, and the
   * next snapshot re-registers them.
   */
  suspend(): void;
}

/**
 * Build a registrar. Every field is closure-local, so a second instance shares
 * nothing — the same rule the runtime, the registry and the writer follow.
 */
export function createLoadpointRegistrar(deps: LoadpointRegistrarDeps): LoadpointRegistrar {
  /** Device ids with a row and a place in the roster, in loadpoint order. */
  let registered: string[] = [];
  /** So a plant that cannot take a device row is reported once, not at 5 Hz. */
  let registrationWarned = false;
  /**
   * What the last `ensureDevice` for an id answered, and when — the memory that
   * makes rule 2 hold for a row that NEVER resolves.
   *
   * Remembering only the ids the registry RESOLVED was the defect: a loadpoint
   * whose row exists but never becomes an instance (the operator retired it; a
   * reload that failed) was re-ensured on every snapshot, and each ensure
   * answered "the row is there", so `added` was true and the whole device table
   * was re-read — at the emit cadence, for the life of the process.
   */
  const attempts = new Map<string, { at: number; state: DeviceRowState }>();
  /** Situations already reported, as `id:state`, so each is said once. */
  const reported = new Set<string>();

  /**
   * How long a loadpoint that did not become an instance waits before its row is
   * ensured again.
   *
   * A cadence rather than "only on a roster change", deliberately: the states
   * that need retrying heal WITHOUT EVCC's roster changing at all — the operator
   * restores the device in Settings → Devices, or a registry reload that failed
   * succeeds. Keyed to a roster change, none of those would ever be noticed and
   * the only cure would be a restart. Five minutes is 1500 snapshots at the
   * 200 ms emit debounce, so the cost is a plant read every five minutes for a
   * plant that is already misconfigured and has said so in the log.
   */
  const RETRY_INTERVAL_MS = 5 * 60_000;

  /**
   * Ensure a row for every id the registry has not resolved, answering whether
   * any of them became registerable.
   *
   * `at` is the snapshot's own instant, which is the clock the retry cadence is
   * measured on — the registrar has no other, and inventing one would be a
   * second time source beside the one every reading is stamped with.
   */
  async function register(loadpoints: readonly EvccLoadpoint[], at: Date): Promise<boolean> {
    const known = new Set(registered);
    let added = false;
    for (const loadpoint of loadpoints) {
      const id = loadpointDeviceId(loadpoint.index);
      // Registered: it has a row and a place in the roster, so there is nothing
      // to do until it leaves.
      if (known.has(id)) continue;
      const previous = attempts.get(id);
      if (previous && at.getTime() - previous.at < RETRY_INTERVAL_MS) continue;
      // Recorded BEFORE the await, and as a failure: an `ensureDevice` that
      // THROWS is a failed attempt like any other, and remembering it only once
      // it resolved let an unreachable device table skip the gate and re-ensure
      // every loadpoint on every snapshot — the very storm this gate exists to
      // stop. The resolved state overwrites it a line later.
      attempts.set(id, { at: at.getTime(), state: "absent" });
      const state = await deps.ensureDevice(id, loadpoint.index, loadpoint.title);
      attempts.set(id, { at: at.getTime(), state });
      // No plant at all: nothing after this one would fare better either.
      if (state === "absent") return added;
      if (state === "ready") added = true;
    }
    return added;
  }

  /** Say a thing about one id at most once, until that id resolves or leaves. */
  function reportOnce(key: string, say: () => void): void {
    if (reported.has(key)) return;
    reported.add(key);
    say();
  }

  /**
   * Say out loud, once, that a loadpoint's readings are going nowhere.
   *
   * The loop this replaced was silent, which is what made it survivable in
   * review and unfindable in production: the symptom was a query storm with no
   * line in the log to attach it to.
   */
  function reportUnstored(id: string): void {
    const attempt = attempts.get(id);
    if (!attempt) return;
    if (attempt.state === "retired") {
      reportOnce(`${id}:retired`, () =>
        deps.logger.warn(
          "EVCC loadpoint device {id} is retired — its charge power is still shown live, but " +
            "nothing is being stored for it. Restore the device in Settings → Devices to resume " +
            "its history.",
          { id },
        ),
      );
      return;
    }
    if (attempt.state === "ready") {
      reportOnce(`${id}:unresolved`, () =>
        deps.logger.warn(
          "EVCC loadpoint device {id} has a row but the plant's roster did not resolve it — " +
            "nothing is being stored for it. Retrying every few minutes.",
          { id },
        ),
      );
    }
  }

  /** Drop what is remembered about an id, so its next appearance starts clean. */
  function forgetAttempt(id: string): void {
    attempts.delete(id);
    reported.delete(`${id}:retired`);
    reported.delete(`${id}:unresolved`);
  }

  /**
   * A sync is already inside its device round trip.
   *
   * The ingest fires one of these per coalesced burst and never awaits it, so a
   * second snapshot arrives while the first is still registering. Both would see
   * the same empty roster, and both would ensure and reload the same rows.
   * Dropping the overlapping snapshot is free: EVCC republishes state
   * continuously and the next burst is 200 ms away.
   */
  let syncing = false;

  /**
   * Bring the roster up to date, answering whether storage may proceed.
   *
   * Rule 2 lives here: one reload per roster CHANGE. A steady roster — the
   * normal state, forever — never re-reads the device table at all. A failure is
   * reported once and is not fatal: EVCC ingest starts even in an onboarding-only
   * boot, and taking the live feed down over a missing plant would be worse than
   * storing nothing for a few seconds.
   */
  async function ensureRoster(loadpoints: readonly EvccLoadpoint[], at: Date): Promise<boolean> {
    try {
      if (await register(loadpoints, at)) await deps.reloadRegistry();
      // Cleared on the next success, not latched for the life of the process:
      // a failure that heals must be re-reportable, or the SECOND, different
      // failure is silent. Same discipline as `../inverter/storage-identity.ts`
      // and the runtime's missing-device warning.
      registrationWarned = false;
      return true;
    } catch (error) {
      if (registrationWarned) return false;
      registrationWarned = true;
      deps.logger.warn(
        "could not register EVCC's loadpoints as devices: {error} — the live feed continues, but nothing is being stored",
        { error: error instanceof Error ? error.message : String(error) },
      );
      return false;
    }
  }

  /**
   * Rule 1, as a belt over the ordering in {@link ensureRoster}: a device the
   * registry has not resolved has no metric list, and committing to it would
   * route undeclared keys through a policy built from nothing.
   */
  function store(loadpoints: readonly EvccLoadpoint[], at: Date): void {
    for (const loadpoint of loadpoints) {
      const device = deps.device(loadpointDeviceId(loadpoint.index));
      if (device) deps.commit(device, loadpointSample(loadpoint, at));
    }
  }

  async function syncOnce(loadpoints: readonly EvccLoadpoint[], at: Date): Promise<void> {
    if (!(await ensureRoster(loadpoints, at))) return;
    store(loadpoints, at);
    // Rule 3, and it runs LAST: a loadpoint that vanished is retired only after
    // the ones that remain have stored this instant's readings.
    const ids = loadpoints.map((l) => loadpointDeviceId(l.index));
    for (const gone of retiredLoadpoints(registered, ids)) deps.forgetDevice(gone);
    // A loadpoint EVCC no longer lists is not a loadpoint we are waiting on:
    // drop what is remembered about it, so a return is a fresh registration
    // (its row may have been retired while it was away).
    const live = new Set(ids);
    // Deleting the key the iterator is standing on is defined behaviour for a
    // Map, so this needs no copy of the key list.
    for (const id of attempts.keys()) if (!live.has(id)) forgetAttempt(id);
    registered = ids.filter((id) => deps.device(id) !== undefined);
    // Resolved is the end of every situation worth reporting.
    for (const id of registered) forgetAttempt(id);
    for (const id of ids) if (!deps.device(id)) reportUnstored(id);
  }

  return {
    async sync(loadpoints, at) {
      if (syncing) return;
      syncing = true;
      try {
        await syncOnce(loadpoints, at);
      } finally {
        syncing = false;
      }
    },
    suspend() {
      registered = [];
      registrationWarned = false;
      attempts.clear();
      reported.clear();
    },
  };
}
