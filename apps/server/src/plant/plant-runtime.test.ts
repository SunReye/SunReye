import { describe, expect, test } from "bun:test";

import type { InverterProfile } from "@SunReye/inverter-core";

import type { ProfileContext } from "../inverter/inverter";
import { type PlantRuntimeDeps, createPlantRuntime } from "./plant-runtime";

/**
 * Every collaborator records its name into one ordered log, so the ORDER — the
 * only content this module has — is what each test asserts.
 */
function recorder(overrides: Partial<PlantRuntimeDeps> = {}) {
  const order: string[] = [];
  const note = (name: string) => async (): Promise<void> => void order.push(name);
  const ctx = { manifest: { id: "m" }, metaByKey: new Map() } as unknown as ProfileContext;
  const plantLive = { snapshot: () => null, stop: () => {} };
  const deps: PlantRuntimeDeps = {
    profile: { id: "deye-sun" } as unknown as InverterProfile,
    provision: async () => void order.push("provision"),
    seedBroker: note("seedBroker"),
    registry: {
      reload: note("registry.reload"),
      primary: () => null,
    },
    buildContext: () => {
      order.push("buildContext");
      return ctx;
    },
    startPlantLive: () => {
      order.push("startPlantLive");
      return plantLive;
    },
    gateDiscovery: note("gateDiscovery"),
    runtime: {
      start: async () => void order.push("runtime.start"),
      armStorage: () => void order.push("runtime.armStorage"),
      reloadEndpoint: note("runtime.reloadEndpoint"),
      stop: note("runtime.stop"),
    },
    connections: { reload: note("connections.reload"), stop: note("connections.stop") },
    evcc: { rebuild: note("evcc.rebuild"), stop: note("evcc.stop") },
    facts: { invalidate: () => void order.push("facts.invalidate") },
    ...overrides,
  };
  return { order, deps, ctx, plantLive };
}

describe("boot", () => {
  test("provisions, seeds the broker, reads the roster, THEN builds the context", async () => {
    // Provisioning creates the rows the roster reads; the broker needs the plant
    // provisioning ensured; the context describes the REGISTERED primary device,
    // so it cannot be built before the roster exists. The live fold and the
    // discovery gate both have to be in place before the HTTP server listens.
    const { order, deps } = recorder();
    await createPlantRuntime(deps).boot();
    expect(order).toEqual([
      "provision",
      "seedBroker",
      "registry.reload",
      "buildContext",
      "startPlantLive",
      "gateDiscovery",
    ]);
  });

  test("hands back the context and the live fold the routes are built from", async () => {
    const { deps, ctx, plantLive } = recorder();
    const booted = await createPlantRuntime(deps).boot();
    expect(booted.ctx).toBe(ctx);
    expect(booted.plantLive).toBe(plantLive);
  });

  test("the context describes the registry's primary device, else the profile", async () => {
    const primary = { id: "inverter-1" };
    const described: unknown[] = [];
    const { deps } = recorder({
      registry: { reload: async () => {}, primary: () => primary as never },
      buildContext: (_profile, device) => {
        described.push(device);
        return {} as ProfileContext;
      },
    });
    await createPlantRuntime(deps).boot();
    const fallback = recorder({
      buildContext: (_profile, device) => {
        described.push(device);
        return {} as ProfileContext;
      },
    });
    await createPlantRuntime(fallback.deps).boot();
    expect(described).toEqual([primary, fallback.deps.profile]);
  });

  test("an onboarding-only boot still provisions the plant and has no context", async () => {
    const { order, deps } = recorder({ profile: null });
    const booted = await createPlantRuntime(deps).boot();
    expect(booted.ctx).toBeNull();
    expect(order).not.toContain("buildContext");
    expect(order[0]).toBe("provision");
  });
});

describe("start", () => {
  test("starts the poll loop, THEN opens the connection tier, THEN rebuilds EVCC", async () => {
    // The Home Assistant export declares its last will when it takes its
    // client, so the tier must not have dialled that row first; the EVCC ingest
    // joins a client the tier already opened rather than opening a second.
    const { order, deps } = recorder();
    const booted = await createPlantRuntime(deps).boot();
    order.length = 0;
    await booted.start(() => false);
    expect(order).toEqual(["runtime.start", "connections.reload", "evcc.rebuild"]);
  });

  test("passes the audience predicate through to the poll loop", async () => {
    const seen: unknown[] = [];
    const watched = () => true;
    const { deps, ctx } = recorder({
      runtime: {
        ...recorder().deps.runtime,
        start: async (context, predicate) => void seen.push(context, predicate),
      },
    });
    await (await createPlantRuntime(deps).boot()).start(watched);
    expect(seen).toEqual([ctx, watched]);
  });

  test("with no profile it arms storage instead — EVCC rows still need a flush", async () => {
    const { order, deps } = recorder({ profile: null });
    const booted = await createPlantRuntime(deps).boot();
    order.length = 0;
    await booted.start(() => false);
    expect(order).toEqual(["runtime.armStorage", "connections.reload", "evcc.rebuild"]);
  });

  test("does not wait for the poll loop's first connect before opening the tier", async () => {
    // Pinned as it ships: `runtime.start` is fired, not awaited, so a gateway
    // that is slow to answer never holds up the brokers or the EVCC ingest.
    const { order, deps } = recorder({
      runtime: {
        ...recorder().deps.runtime,
        start: () => new Promise<void>(() => {}),
      },
    });
    const booted = await createPlantRuntime(deps).boot();
    order.length = 0;
    await booted.start(() => false);
    expect(order).toEqual(["connections.reload", "evcc.rebuild"]);
  });
});

describe("afterPlantWrite", () => {
  test("drops the plant facts, re-opens the connections, THEN re-reads the endpoint", async () => {
    // Facts first, so nothing the reload triggers reads the stale PV arrays.
    // Connections before the endpoint, because the endpoint reload rebuilds the
    // Home Assistant export, which takes its client FROM a connection.
    const { order, deps } = recorder();
    await createPlantRuntime(deps).afterPlantWrite();
    expect(order).toEqual(["facts.invalidate", "connections.reload", "runtime.reloadEndpoint"]);
  });

  test("a failing reload still leaves the facts dropped", async () => {
    const { order, deps } = recorder({
      connections: {
        reload: async () => {
          throw new Error("broker unreachable");
        },
        stop: async () => {},
      },
    });
    await expect(createPlantRuntime(deps).afterPlantWrite()).rejects.toThrow("broker unreachable");
    expect(order).toEqual(["facts.invalidate"]);
  });
});

describe("stop", () => {
  test("releases EVCC and the poll loop BEFORE closing the connections", async () => {
    // Both consumers let go of their hold first, so the tier closes the sockets
    // that are genuinely left rather than yanking one out from under a bridge
    // still publishing its "offline" availability.
    const { order, deps } = recorder();
    await createPlantRuntime(deps).stop();
    expect(order).toEqual(["evcc.stop", "runtime.stop", "connections.stop"]);
  });
});
