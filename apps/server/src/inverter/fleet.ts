/**
 * One poll loop per device.
 *
 * The runtime was always a factory whose every field is closure-local, so N
 * instances were never the hard part. What is hard is deciding which of the
 * things a single runtime used to do are per device and which are per plant,
 * and this module is where that decision lives:
 *
 * - **per device** — the poll loop, the source, the MQTT bridge, the history
 *   buffer and its flush. A device's readings, its topics and its rows are its
 *   own, and two devices sharing any of them is a silent wrong number.
 * - **per plant** — the PV forecast, the correction model, the day-ahead prices
 *   (all in `./plant-jobs`), and the automation engine, which steers one battery
 *   through one funnel and would be re-pointed out from under itself by a second
 *   instance.
 *
 * One more restriction, and it is temporary: only the default device's samples
 * are emitted on the `metrics` stream. That topic is flat and the browser keys
 * its readings by bare role name, so a second device's frames would overwrite
 * the first's *at the new timestamp* — both numbers looking perfectly current
 * while alternating between two machines. Their readings still reach history and
 * MQTT, which are keyed by device and handle it correctly. The restriction lifts
 * when the frames carry a device (see the plant-level role resolution work).
 */

import { log } from "../shared/logging";
import type { Streams } from "../shared/streams";
import type { Device } from "./device-registry";
import { startPlantJobs, stopPlantJobs } from "./plant-jobs";
import { createRuntime as createRealRuntime, type RuntimeDevice } from "./runtime";

const logger = log("fleet");

/** The slice of a runtime the fleet drives. */
export interface FleetRuntime {
  start(
    streams: Streams,
    device: RuntimeDevice,
    opts?: { automationsWatched?: () => boolean; automations?: boolean },
  ): Promise<void>;
  stop(): Promise<void>;
}

export interface Fleet {
  /** How many devices are being polled. */
  readonly size: number;
  /** The ids being polled, in start order. */
  ids(): string[];
  /** Stop every loop and the plant's jobs. */
  stop(): Promise<void>;
}

export interface FleetDeps {
  /** Build a runtime for one device; the real factory by default. */
  createRuntime?: (device: Device) => FleetRuntime;
  plantJobs?: { start(streams: Streams): void; stop(): void };
}

/**
 * A bus that drops `metrics` and forwards everything else — what a non-default
 * device's runtime is given. Not a no-op bus: a secondary device still has
 * things to say that are not per-device readings.
 */
function withoutMetrics(streams: Streams): Streams {
  return {
    emit(topic, payload) {
      if (topic === "metrics") return;
      streams.emit(topic, payload);
    },
    subscribe: (topic, listener) => streams.subscribe(topic, listener),
  };
}

/**
 * Start a loop for every pollable device.
 *
 * A device whose runtime fails to start is dropped with a log line and the rest
 * still run: one unreachable inverter must cost its own readings and nothing
 * else. Nothing is started at all when there are no devices — the onboarding
 * boot, where there is nothing to poll and nothing to forecast for.
 */
export async function startFleet(
  opts: {
    devices: Device[];
    defaultDeviceId: string | null;
    streams: Streams;
    automationsWatched?: () => boolean;
  },
  deps: FleetDeps = {},
): Promise<Fleet> {
  const make = deps.createRuntime ?? (() => createRealRuntime());
  const plant = deps.plantJobs ?? { start: startPlantJobs, stop: stopPlantJobs };
  const pollable = opts.devices.filter((d) => d.enabled && d.source.enabled);
  const running = new Map<string, FleetRuntime>();

  /**
   * Start one device's loop, or report why it did not start. A device that will
   * not answer must cost its own readings and nothing else, so the failure is
   * swallowed here rather than aborting the loop over the fleet.
   */
  async function startOne(device: Device): Promise<FleetRuntime | null> {
    const isDefault = device.id === opts.defaultDeviceId;
    const runtime = make(device);
    try {
      await runtime.start(isDefault ? opts.streams : withoutMetrics(opts.streams), device, {
        automationsWatched: isDefault ? opts.automationsWatched : undefined,
        automations: isDefault,
      });
      return runtime;
    } catch (error) {
      logger.error("device {id} failed to start — the others keep polling: {error}", {
        id: device.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  for (const device of pollable) {
    const runtime = await startOne(device);
    if (runtime) running.set(device.id, runtime);
  }

  if (running.size > 0) plant.start(opts.streams);
  else if (pollable.length === 0) logger.info("no pollable devices — nothing to start");

  return {
    get size() {
      return running.size;
    },
    ids: () => [...running.keys()],
    async stop() {
      for (const [id, runtime] of running) {
        // One runtime that will not shut down cleanly must not strand the rest,
        // least of all the buffered history the others still have to flush.
        try {
          await runtime.stop();
        } catch (error) {
          logger.warn("device {id} did not stop cleanly: {error}", { id, error });
        }
      }
      plant.stop();
    },
  };
}
