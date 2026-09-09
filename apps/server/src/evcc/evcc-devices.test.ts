/**
 * The loadpoint -> device mapping: EVCC's opinionated snapshot, reduced to the
 * part of it that is the SAME question for every wallbox integration.
 *
 * Pure, so the falsification test this step is — does the contract host the most
 * opinionated integration in the tree without hollowing it out? — is answerable
 * without a broker, a database or a poll loop.
 */
import { describe, expect, test } from "bun:test";
import type { EvccLoadpoint } from "@SunReye/contracts/evcc";
import { deriveCapabilities, deviceInstance } from "@SunReye/inverter-core";

import {
  LOADPOINT_METRICS,
  loadpointDeviceId,
  loadpointDeviceSpec,
  loadpointSample,
  retiredLoadpoints,
} from "./evcc-devices";

/** An EVCC loadpoint with every field at its "nothing plugged in" value. */
function loadpoint(overrides: Partial<EvccLoadpoint> = {}): EvccLoadpoint {
  return {
    index: 1,
    title: "Carport",
    mode: "pv",
    chargePower: 0,
    chargePowerLive: 0,
    chargePowerSource: "measured",
    charging: false,
    connected: false,
    vehicleSoc: null,
    vehicleRange: null,
    vehicleTitle: null,
    vehicleName: null,
    sessionEnergy: null,
    chargeRemainingEnergy: null,
    limitSoc: null,
    effectiveLimitSoc: null,
    vehicleLimitSoc: null,
    batteryBoost: false,
    batteryBoostLimit: null,
    vehicleCapacityKwh: null,
    phasesActive: null,
    ...overrides,
  };
}

const T0 = new Date("2026-08-30T12:00:00.000Z");

describe("one EVCC source, N loadpoints, N devices", () => {
  /** A loadpoint as the registry builds it: the declaration, plus the row's id. */
  const device = (index: number) =>
    deviceInstance({
      id: loadpointDeviceId(index),
      deviceClass: "charger",
      integration: "evcc",
      metrics: LOADPOINT_METRICS,
    });

  test("two loadpoints are two devices, each with its own id", () => {
    // The concrete win of this step: before it there was ONE `evcc` surface and
    // no identity at all, so nothing a loadpoint reported could be keyed to
    // anything and none of it reached `metrics_raw`.
    const one = device(1);
    const two = device(2);

    expect(one.id).toBe("evcc-loadpoint-1");
    expect(two.id).toBe("evcc-loadpoint-2");
    expect(one.id).not.toBe(two.id);
    expect(loadpointDeviceId(2)).toBe(two.id);
  });

  test("a loadpoint binds the EV roles and nothing else", () => {
    expect([...device(1).roles.keys()]).toEqual([
      "ev.charge.power",
      "ev.vehicle.soc",
      "ev.session.energy",
      "ev.connected",
      "ev.charging",
    ]);
  });

  test("a loadpoint declares no controls and no house hardware", () => {
    // Capabilities are DERIVED, so the coded tier cannot declare a battery it
    // does not have — and EVCC's writable surface (mode, limitSoc, the boost) is
    // deliberately not a role, so it is not a `controls` entry either.
    expect(deriveCapabilities(device(1))).toMatchObject({
      battery: false,
      grid: false,
      pvStrings: 0,
      generator: false,
      controls: [],
    });
  });

  test("zero loadpoints is zero devices, not an empty one", () => {
    expect(retiredLoadpoints([], [])).toEqual([]);
    expect(retiredLoadpoints(["evcc-loadpoint-1"], [])).toEqual(["evcc-loadpoint-1"]);
  });

  test("a loadpoint that disappears between polls is the one to retire", () => {
    // EVCC's loadpoint count changes when its config is edited and the instance
    // reloads. The device that is gone must stop being written to; the ones that
    // remain must not be disturbed.
    expect(
      retiredLoadpoints(
        ["evcc-loadpoint-1", "evcc-loadpoint-2"],
        ["evcc-loadpoint-1", "evcc-loadpoint-3"],
      ),
    ).toEqual(["evcc-loadpoint-2"]);
  });
});

describe("the `devices` row a loadpoint needs", () => {
  test("is an endpoint-less charger on no connection and no bus", () => {
    // The shape a poll loop can never serve: no `connections` row, no unit on a
    // bus, and a `profile_id` that names a coded declaration rather than an
    // installable register map.
    expect(loadpointDeviceSpec(7, 1, "Carport")).toEqual({
      plantId: 7,
      connectionId: null,
      unitId: 0,
      slug: "evcc-loadpoint-1",
      name: "Carport",
      profileId: "evcc-loadpoint",
      role: "charger",
    });
  });

  test("an untitled loadpoint still gets a name a human can pick out", () => {
    // `name` is a CREATION default the operator may then edit, so it must never
    // be empty — but the slug is frozen, so the fallback cannot be the slug.
    expect(loadpointDeviceSpec(7, 2, null).name).toBe("EVCC loadpoint 2");
  });
});

describe("a loadpoint's sample is the generic half of it, and nothing else", () => {
  test("a charging car reports power, SoC, session energy and both states", () => {
    const sample = loadpointSample(
      loadpoint({
        chargePower: 7200,
        chargePowerLive: 7200,
        connected: true,
        charging: true,
        vehicleSoc: 62,
        // EVCC publishes session energy in Wh; the plant's energy unit is kWh,
        // and the unit travels with the key into `metric_keys`.
        sessionEnergy: 4500,
      }),
      T0,
    );

    expect(sample).toEqual({
      time: T0,
      metrics: {
        "ev.charge.power": 7200,
        "ev.vehicle.soc": 62,
        "ev.session.energy": 4.5,
        "ev.connected": 1,
        "ev.charging": 1,
      },
      provenance: { "ev.charge.power": "measured" },
    });
  });

  test("the three-layer charge limit is nowhere in it", () => {
    // `limitSoc: 0` is "no session override", NOT "no limit" — a distinction
    // that took a live instance to get right, that EVCC resolves itself into
    // `effectiveLimitSoc`, and that no other wallbox integration shares. Flatten
    // it into a role and every one of them has to fake it. It stays on EVCC's
    // own surface: an integration may expose MORE than the contract.
    const sample = loadpointSample(
      loadpoint({
        connected: true,
        limitSoc: 0,
        effectiveLimitSoc: 80,
        vehicleLimitSoc: 90,
        batteryBoost: true,
        batteryBoostLimit: 30,
        mode: "pv",
      }),
      T0,
    );

    expect(Object.keys(sample.metrics).sort()).toEqual([
      "ev.charge.power",
      "ev.charging",
      "ev.connected",
    ]);
  });

  test("a session with no vehicle identified reports no SoC to guess at", () => {
    // A guest car: EVCC knows a session is running and knows nothing about the
    // pack. An absent value is absent — writing 0 would be a reading that says
    // the car is empty.
    const sample = loadpointSample(
      loadpoint({ connected: true, charging: true, chargePowerLive: 3600, vehicleSoc: null }),
      T0,
    );

    expect(sample.metrics["ev.vehicle.soc"]).toBeUndefined();
    expect(sample.metrics["ev.charge.power"]).toBe(3600);
    expect(sample.metrics["ev.connected"]).toBe(1);
  });

  test("an unplugged loadpoint still reports its zero, because zero is a reading", () => {
    const sample = loadpointSample(loadpoint(), T0);
    expect(sample.metrics).toEqual({
      "ev.charge.power": 0,
      "ev.connected": 0,
      "ev.charging": 0,
    });
  });

  test("a session that has just started reports zero energy, not nothing", () => {
    const sample = loadpointSample(loadpoint({ connected: true, sessionEnergy: 0 }), T0);
    expect(sample.metrics["ev.session.energy"]).toBe(0);
  });

  test("an estimated or fed-forward power carries EVCC's own provenance", () => {
    // The whole point of promoting `ChargePowerSource` into the sample model:
    // the live figure is the right thing to PAINT and the wrong thing to store,
    // and the write seam already knows the difference for every device.
    const feedforward = loadpointSample(
      loadpoint({
        chargePower: 0,
        chargePowerLive: 11000,
        chargePowerSource: "feedforward",
        connected: true,
      }),
      T0,
    );
    expect(feedforward.metrics["ev.charge.power"]).toBe(11000);
    expect(feedforward.provenance).toEqual({ "ev.charge.power": "feedforward" });

    const estimated = loadpointSample(
      loadpoint({ chargePowerLive: 6800, chargePowerSource: "estimated", connected: true }),
      T0,
    );
    expect(estimated.provenance).toEqual({ "ev.charge.power": "estimated" });
  });
});
