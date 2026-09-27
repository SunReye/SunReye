/**
 * The plant's composition: the one poll loop, the EVCC ingest, the connection
 * probes and the plant runtime over them, bound to the real process. Wiring
 * only — the ORDER lives in `./plant-runtime.ts`, where it is tested; importing
 * this module pulls in `@SunReye/env` and the database client, which is why the
 * two are separate.
 */

import type { InverterProfile } from "@SunReye/inverter-core";

import { reloadConnections, stopConnections } from "../devices/connection-runtime";
import { deviceRegistry } from "../devices/registry-instance";
import type { EvccIngest } from "../evcc/evcc";
import { installEvccIngest } from "../evcc/evcc-instance";
import { createPlantEvccIngest } from "../evcc/evcc-storage";
import type { ConnectionProbes } from "../inverter/connection-probes";
import { buildProfileContext } from "../inverter/inverter";
import { startPlantLive } from "../inverter/plant-live";
import { syncProvisioning } from "../inverter/provision-boot";
import { type Runtime, createRuntime } from "../inverter/runtime";
import { productionConnectionProbes, productionRuntimeDeps } from "../inverter/runtime-wiring";
import { liveMembers } from "../routes/sources";
import { seedMqttBroker } from "../settings/mqtt-broker-instance";
import { plantFacts } from "../settings/plant-facts-instance";
import { log } from "../shared/logging";
import type { Streams } from "../shared/streams";
import { type PlantRuntime, type PlantRuntimeDeps, createPlantRuntime } from "./plant-runtime";

/**
 * HOLD HOME ASSISTANT DISCOVERY when a 1.x -> 2.0.0 migration has not been
 * through onboarding yet.
 *
 * A discovery announcement is retained and Home Assistant keys its entities on
 * `unique_id`. Announcing under the placeholder identity the migration
 * synthesises is therefore not something a later rename can take back, so it
 * waits for the operator's names — see ../migration/onboarding.ts. A no-op on
 * every install that never ran a 1.x upgrade, which is the important half: a
 * gate that engaged by accident looks exactly like a broken MQTT bridge.
 *
 * Never throws. A migration record that cannot be read must not stop the server
 * booting; the gate simply stays open, which is the state every healthy install
 * is in anyway.
 */
async function gateDiscovery(): Promise<void> {
  try {
    const { readMigrationRecord } = await import("../migration/record");
    const { migrationGateReason } = await import("../migration/onboarding");
    const { holdDiscovery } = await import("../migration/discovery-gate");
    const reason = migrationGateReason(await readMigrationRecord());
    if (reason !== null) {
      holdDiscovery(reason);
      log("migration").warn("Home Assistant discovery is held: {reason}", { reason });
    }
  } catch (error) {
    log("migration").warn("could not read the migration record; discovery is not held: {error}", {
      error: (error as Error).message,
    });
  }
}

/** The real collaborators, for the process's one plant runtime. */
function plantRuntimeDeps(wiring: {
  profile: InverterProfile | null;
  streams: Streams;
  runtime: Runtime;
  evcc: Pick<EvccIngest, "rebuild" | "stop">;
}): PlantRuntimeDeps {
  const { runtime, streams } = wiring;
  return {
    profile: wiring.profile,
    provision: (profile) => syncProvisioning(profile),
    seedBroker: seedMqttBroker,
    registry: {
      reload: () => deviceRegistry.reload(),
      primary: () => deviceRegistry.primary(),
    },
    buildContext: buildProfileContext,
    startPlantLive: (aggregateOf) => startPlantLive({ streams, members: liveMembers, aggregateOf }),
    gateDiscovery,
    runtime: {
      start: (ctx, watched) => runtime.start(streams, ctx, watched),
      armStorage: runtime.armStorage,
      reloadEndpoint: runtime.reloadEndpoint,
      stop: runtime.stop,
    },
    connections: { reload: reloadConnections, stop: stopConnections },
    evcc: wiring.evcc,
    facts: plantFacts,
  };
}

/** Everything the HTTP layer is built over, composed once per process. */
export interface ComposedPlant {
  plant: PlantRuntime;
  runtime: Runtime;
  evcc: EvccIngest;
  probes: ConnectionProbes;
}

/**
 * Build the process's one poll loop, EVCC ingest and plant runtime.
 *
 * The runtime and the ingest need each other — the poll loop feeds the ingest
 * its house load, the ingest stores its loadpoints through the runtime's write
 * seam — so each reaches the other through a closure, read only once the
 * process is running and both exist.
 */
export function composePlant(wiring: {
  profile: InverterProfile | null;
  streams: Streams;
}): ComposedPlant {
  const { streams } = wiring;
  const runtime = createRuntime(
    productionRuntimeDeps({
      devices: deviceRegistry,
      onLoadSample: (watts) => evcc.onLoadSample(watts),
    }),
  );
  const evcc = createPlantEvccIngest({ streams, registry: deviceRegistry, writer: runtime });
  // The automation IO is still built from a dynamic import, so it reaches the
  // ingest through this one installed instance.
  installEvccIngest(evcc);
  const plant = createPlantRuntime(
    plantRuntimeDeps({ profile: wiring.profile, streams, runtime, evcc }),
  );
  return { plant, runtime, evcc, probes: productionConnectionProbes(deviceRegistry) };
}
