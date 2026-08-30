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

/** The one failure path this logs; kept minimal so any logger satisfies it. */
export interface RegistrarLogger {
  warn(template: string, values?: Record<string, unknown>): void;
}

export interface LoadpointRegistrarDeps {
  /**
   * Create the loadpoint's `devices` row if it is not already there, and answer
   * whether it now exists. `false` is a legal answer: EVCC ingest starts even in
   * an onboarding-only boot, where there is no plant to hang a device on yet.
   */
  ensureDevice(id: string, index: number, title: string | null): Promise<boolean>;
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

  /** Ensure a row for every id that has none, answering whether any was added. */
  async function register(loadpoints: readonly EvccLoadpoint[]): Promise<boolean> {
    const known = new Set(registered);
    let added = false;
    for (const loadpoint of loadpoints) {
      const id = loadpointDeviceId(loadpoint.index);
      if (known.has(id)) continue;
      if (!(await deps.ensureDevice(id, loadpoint.index, loadpoint.title))) return added;
      added = true;
    }
    return added;
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
  async function ensureRoster(loadpoints: readonly EvccLoadpoint[]): Promise<boolean> {
    try {
      if (await register(loadpoints)) await deps.reloadRegistry();
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
    if (!(await ensureRoster(loadpoints))) return;
    store(loadpoints, at);
    // Rule 3, and it runs LAST: a loadpoint that vanished is retired only after
    // the ones that remain have stored this instant's readings.
    const ids = loadpoints.map((l) => loadpointDeviceId(l.index));
    for (const gone of retiredLoadpoints(registered, ids)) deps.forgetDevice(gone);
    registered = ids.filter((id) => deps.device(id) !== undefined);
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
    },
  };
}
