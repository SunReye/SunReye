/**
 * THE PLANT'S LIFECYCLE, in the one order that works — boot, every write that
 * changes what the plant is, and shutdown. That order used to be a script down
 * `../index.ts` with its constraints only in comments; here each step is an
 * injected collaborator, so the order is observable and tested. Sits ABOVE the
 * poll loop (`../inverter/runtime.ts`): it calls it, it does not absorb it.
 */

import type { CapabilityInputs, InverterProfile } from "@SunReye/inverter-core";

import type { ProfileContext } from "../inverter/inverter";
import type { PlantLive } from "../inverter/plant-live";
import { aggregateOfMetric } from "../shared/plant-read";
import type { AggregateOf } from "../shared/plant-fold";

/** The poll loop, as far as the plant's lifecycle drives it. */
export interface PlantPollLoop {
  start(ctx: ProfileContext, automationsWatched: () => boolean): Promise<void>;
  /** The flush cadence alone, for the boot with no profile to poll (#88). */
  armStorage(): void;
  reloadEndpoint(): Promise<void>;
  stop(): Promise<void>;
}

export interface PlantRuntimeDeps {
  /** The active profile, or null on an onboarding-only boot. */
  profile: InverterProfile | null;
  /** Ensure the plant (and, with a profile, its connection and device) exist. Never throws. */
  provision(profile: InverterProfile | null): Promise<unknown>;
  /** Carry the env broker into the spine once (#217). Never throws. */
  seedBroker(): Promise<void>;
  registry: { reload(): Promise<unknown>; primary(): CapabilityInputs | null };
  buildContext(profile: InverterProfile, device: CapabilityInputs): ProfileContext;
  startPlantLive(aggregateOf: AggregateOf): PlantLive;
  /** Hold Home Assistant discovery while a 1.x migration awaits onboarding. Never throws. */
  gateDiscovery(): Promise<void>;
  runtime: PlantPollLoop;
  /** The connection tier (#221): one client per broker row. */
  connections: { reload(): Promise<void>; stop(): Promise<void> };
  evcc: { rebuild(): Promise<void>; stop(): Promise<void> };
  /** The cached plant facts (`../settings/plant-facts.ts`). */
  facts: { invalidate(): void };
}

/** What the first half of boot hands the HTTP layer, and the second half. */
export interface BootedPlant {
  /** The transports' context, or null on an onboarding-only boot. */
  ctx: ProfileContext | null;
  plantLive: PlantLive;
  /**
   * The second half of boot, run once the server is listening. Separate from
   * {@link PlantRuntime.boot} because the routes are built from `ctx` in between.
   */
  start(automationsWatched: () => boolean): Promise<void>;
}

export interface PlantRuntime {
  boot(): Promise<BootedPlant>;
  /** What every device, connection or integration write is followed by. */
  afterPlantWrite(): Promise<void>;
  stop(): Promise<void>;
}

/** What a route that writes the plant needs of it: the one after-write. */
export type PlantWrites = Pick<PlantRuntime, "afterPlantWrite">;

export function createPlantRuntime(deps: PlantRuntimeDeps): PlantRuntime {
  async function boot(): Promise<BootedPlant> {
    const { profile } = deps;
    // 1. THE SPINE. Before anything polls: `metrics_raw.device_id` is a NOT NULL
    //    foreign key, so a first sample that beat its device row would be dropped.
    await deps.provision(profile);
    // 2. THE BROKER — after provisioning, because a connection needs a plant to
    //    belong to, and before the poll loop reads the export config.
    await deps.seedBroker();
    // 3. THE ROSTER — after the rows exist, before any route reads history from it.
    await deps.registry.reload();
    // 4. THE CONTEXT — after the roster: it describes the REGISTERED primary
    //    device, falling back to the profile when nothing is registered.
    const ctx = profile ? deps.buildContext(profile, deps.registry.primary() ?? profile) : null;
    // 5. THE LIVE FOLD — before any `/ws` connection can subscribe to it.
    const plantLive = deps.startPlantLive(aggregateOfMetric(ctx?.metaByKey ?? new Map()));
    // 6. THE DISCOVERY GATE — before the MQTT bridge dials: the announcement
    //    goes out in a synchronous connect handler that cannot await a read.
    await deps.gateDiscovery();
    return { ctx, plantLive, start: (watched) => start(ctx, watched) };
  }

  async function start(
    ctx: ProfileContext | null,
    automationsWatched: () => boolean,
  ): Promise<void> {
    // 7. THE POLL LOOP — awaited, because the export takes its client (and its
    //    last will) inside it. Cannot hang on the inverter: it reads the
    //    database and arms timers, and the first poll runs on the interval.
    //    With no profile only the flush cadence is armed, so rows the EVCC
    //    ingest writes still drain.
    if (ctx) await deps.runtime.start(ctx, automationsWatched);
    else deps.runtime.armStorage();
    // 8. THE CONNECTION TIER — after the loop took the export's client with its
    //    last will (an LWT is connect-time), before EVCC joins a client.
    await deps.connections.reload();
    // 9. THE EVCC INGEST — fire-and-forget: its broker may be slow or absent,
    //    and the boot after it has nothing to wait on.
    void deps.evcc.rebuild();
  }

  async function afterPlantWrite(): Promise<void> {
    // Facts first, so nothing the reload triggers reads the stale PV arrays.
    deps.facts.invalidate();
    // Connections before the endpoint: the endpoint reload rebuilds the Home
    // Assistant export, which takes its client FROM a connection. Reversed, an
    // integration added on a brand-new broker would come up silent.
    await deps.connections.reload();
    await deps.runtime.reloadEndpoint();
  }

  async function stop(): Promise<void> {
    await deps.evcc.stop();
    await deps.runtime.stop();
    // LAST: both consumers released their hold first, so this closes the
    // sockets that are genuinely left rather than one a bridge still publishes on.
    await deps.connections.stop();
  }

  return { boot, afterPlantWrite, stop };
}
