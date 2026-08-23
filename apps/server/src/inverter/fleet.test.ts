import { describe, expect, test } from "bun:test";
import type { InverterSample } from "@SunReye/inverter-core";

import { createStreams } from "../shared/streams";
import type { Device } from "./device-registry";
import { startFleet, type FleetRuntime } from "./fleet";
import type { ProfileContext } from "./inverter";

const ctx = (id: string) => ({ profile: { id } }) as unknown as ProfileContext;

const device = (id: string, over: Partial<Device> = {}): Device =>
  ({
    id,
    label: id,
    deviceClass: "inverter",
    source: { id: "default", kind: "modbus", label: "Bus", config: {}, enabled: true },
    address: {},
    enabled: true,
    ctx: ctx(id),
    ...over,
  }) as Device;

/** A runtime double: records how it was started and what it was given. */
function fakeRuntime(over: { failOnStart?: string } = {}) {
  const started: { deviceId: string; automations: boolean }[] = [];
  let stops = 0;
  let bus: ReturnType<typeof createStreams> | null = null;
  const runtime: FleetRuntime = {
    async start(streams, dev, opts) {
      if (over.failOnStart) throw new Error(over.failOnStart);
      bus = streams as ReturnType<typeof createStreams>;
      started.push({ deviceId: dev.id, automations: opts?.automations !== false });
    },
    async stop() {
      stops++;
    },
  };
  return {
    runtime,
    started,
    get stops() {
      return stops;
    },
    /** Emit a sample the way this runtime's poll loop would. */
    poll(deviceId: string) {
      bus?.emit("metrics", {
        time: "2026-08-15T10:00:00.000Z",
        inverterId: deviceId,
        metrics: { "battery.soc": 42 },
      } satisfies InverterSample);
    },
  };
}

function harness(devices: Device[], defaultDeviceId: string | null) {
  const made: ReturnType<typeof fakeRuntime>[] = [];
  const plant = { starts: 0, stops: 0 };
  const streams = createStreams();
  const published: InverterSample[] = [];
  streams.subscribe("metrics", (s) => published.push(s));
  return {
    made,
    plant,
    streams,
    published,
    start: (over: { failing?: Set<string> } = {}) =>
      startFleet(
        { devices, defaultDeviceId, streams },
        {
          createRuntime: (dev) => {
            const made_ = fakeRuntime({
              failOnStart: over.failing?.has(dev.id) ? `${dev.id} is unreachable` : undefined,
            });
            made.push(made_);
            return made_.runtime;
          },
          plantJobs: {
            start: () => {
              plant.starts++;
            },
            stop: () => {
              plant.stops++;
            },
          },
        },
      ),
  };
}

// One device is the case every install has; the fleet exists so the second one
// costs nothing but a row. What must never happen is the two of them sharing
// anything that carries a value.
describe("one runtime per device", () => {
  test("a single-device install runs exactly one, exactly as before", async () => {
    const h = harness([device("only")], "only");

    await h.start();

    expect(h.made).toHaveLength(1);
    expect(h.made[0]?.started).toEqual([{ deviceId: "only", automations: true }]);
  });

  test("two devices get a loop each, each told which device it serves", async () => {
    const h = harness([device("roof"), device("barn")], "roof");

    await h.start();

    expect(h.made.flatMap((m) => m.started.map((s) => s.deviceId))).toEqual(["roof", "barn"]);
  });

  test("a device that is not pollable gets no loop", async () => {
    // Disabled means "do not poll me"; it still has a row and a history.
    const h = harness([device("roof"), device("off", { enabled: false })], "roof");

    await h.start();

    expect(h.made.flatMap((m) => m.started.map((s) => s.deviceId))).toEqual(["roof"]);
  });

  test("a device on a disabled source gets no loop either", async () => {
    const off = device("cloudy", {
      source: { id: "s2", kind: "http", label: "Cloud", config: {}, enabled: false },
    });
    const h = harness([device("roof"), off], "roof");

    await h.start();

    expect(h.made.flatMap((m) => m.started.map((s) => s.deviceId))).toEqual(["roof"]);
  });

  test("no devices at all starts nothing, including the plant's jobs", async () => {
    // Onboarding-only boot: there is nothing to poll and nothing to forecast for.
    const h = harness([], null);

    const fleet = await h.start();

    expect(h.made).toEqual([]);
    expect(h.plant.starts).toBe(0);
    expect(fleet.size).toBe(0);
  });
});

describe("what only one of them may do", () => {
  test("the plant's jobs are started once, however many devices there are", async () => {
    // One PV forecast, one correction model, one price series. Arming them per
    // device would fetch the same forecast twice every five minutes.
    const h = harness([device("roof"), device("barn"), device("shed")], "roof");

    await h.start();

    expect(h.plant.starts).toBe(1);
  });

  test("only the default device's runtime runs the automations", async () => {
    // The engine steers one battery through one funnel; a second instance would
    // re-point the first's engine out from under it.
    const h = harness([device("roof"), device("barn")], "roof");

    await h.start();

    const automations = h.made.flatMap((m) => m.started.filter((s) => s.automations));
    expect(automations.map((s) => s.deviceId)).toEqual(["roof"]);
  });

  test("only the default device's samples reach the metrics topic", async () => {
    // The topic is flat and the browser keys its readings by bare role name, so
    // a second device's frames would overwrite the first's *at the new
    // timestamp* — both numbers looking current while alternating. Until the
    // frames carry a device, the extra devices stay off the wire; their
    // readings still reach history and MQTT.
    const h = harness([device("roof"), device("barn")], "roof");
    await h.start();

    h.made[0]?.poll("roof");
    h.made[1]?.poll("barn");

    expect(h.published.map((s) => s.inverterId)).toEqual(["roof"]);
  });
});

describe("one bad device", () => {
  test("does not stop the others from starting", async () => {
    // A device that will not answer must cost its own readings and nothing else.
    const h = harness([device("roof"), device("barn"), device("shed")], "roof");

    const fleet = await h.start({ failing: new Set(["barn"]) });

    expect([...fleet.ids()]).toEqual(["roof", "shed"]);
  });

  test("a failing default device still leaves the others polling", async () => {
    const h = harness([device("roof"), device("barn")], "roof");

    const fleet = await h.start({ failing: new Set(["roof"]) });

    expect([...fleet.ids()]).toEqual(["barn"]);
  });
});

describe("shutting the fleet down", () => {
  test("stops every runtime and the plant's jobs", async () => {
    const h = harness([device("roof"), device("barn")], "roof");
    const fleet = await h.start();

    await fleet.stop();

    expect(h.made.map((m) => m.stops)).toEqual([1, 1]);
    expect(h.plant.stops).toBe(1);
  });

  test("a runtime that throws on stop does not strand the rest", async () => {
    const h = harness([device("roof"), device("barn")], "roof");
    const fleet = await h.start();
    const first = h.made[0];
    if (!first) throw new Error("no runtime was built");
    (first.runtime as { stop: () => Promise<void> }).stop = async () => {
      throw new Error("socket already gone");
    };

    await fleet.stop();

    expect(h.made[1]?.stops).toBe(1);
    expect(h.plant.stops).toBe(1);
  });
});
