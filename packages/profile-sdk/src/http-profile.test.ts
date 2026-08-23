import { describe, expect, test } from "bun:test";

import {
  deriveCapabilities,
  HttpTransport,
  hydrateProfile,
  ModbusInverter,
  type InverterConnection,
} from "@SunReye/inverter-core";

import { shellyPro3em, shellyStatusBody } from "./__fixtures__/shelly-pro-3em";
import { missingRequiredRoles } from "./coverage";
import { lintProfile, validateProfile } from "./validate";

// The falsification test for the transport seam: a real device that is not a
// register map, authored through the same SDK, read through the same pipeline.
// The criterion from the issue is that it must need no fourth binding arm, no
// bespoke code path and no special case inside the shared pipeline. Everything
// below is an assertion about that, not about Shelly.

/** The device, answering the documented body to every GET. */
const meter = (body: unknown = shellyStatusBody) => {
  const requests: string[] = [];
  const fetch = ((input: string | URL | Request) => {
    requests.push(String(input));
    return Promise.resolve(new Response(JSON.stringify(body)));
  }) as unknown as typeof globalThis.fetch;
  const profile = hydrateProfile(shellyPro3em);
  const transport = new HttpTransport(
    profile,
    { url: "http://10.0.0.9/rpc/Shelly.GetStatus" },
    {
      fetch,
    },
  );
  // The connection argument is the Modbus one and is never reached: the
  // transport is injected, so nothing constructs a ModbusTransport.
  const unused = { host: "", port: 0, unitId: 0 } satisfies InverterConnection;
  return { requests, profile, source: new ModbusInverter(profile, unused, transport) };
};

describe("a non-inverter profile authored against the http arm", () => {
  test("passes the same validation every published profile passes", () => {
    const result = validateProfile(shellyPro3em);

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("draws no plausibility lint — including the kind of the unroled metric", () => {
    expect(lintProfile(shellyPro3em)).toEqual([]);
  });

  test("clears the required-role floor without an override", () => {
    // The floor scales to the hardware: this profile touches only the grid
    // family, whose anchor is `grid.power`, and it maps it.
    expect(missingRequiredRoles(shellyPro3em)).toEqual([]);
  });

  test("derives the capabilities of a meter, not of an inverter", () => {
    const caps = deriveCapabilities(hydrateProfile(shellyPro3em));

    expect(caps).toMatchObject({
      grid: true,
      phases: 3,
      battery: false,
      pvStrings: 0,
      generator: false,
      backupLoad: false,
    });
    // Nothing writable: the transport cannot write, and the profile does not
    // pretend otherwise.
    expect(caps.controls).toEqual([]);
  });
});

describe("the meter read through the shared pipeline", () => {
  test("one GET becomes a sample of engineering values", async () => {
    const { source, requests } = meter();

    const sample = await source.read();

    expect(requests).toEqual(["http://10.0.0.9/rpc/Shelly.GetStatus"]);
    expect(sample.inverterId).toBe("shelly-pro-3em");
    expect(sample.metrics).toEqual({
      "grid.power": 2484.782,
      "grid.phase1.power": 951.2,
      "grid.phase1.voltage": 236.1,
      "grid.phase1.current": 4.029,
      "grid.phase2.power": -951.1,
      "grid.phase2.voltage": 236.201,
      "grid.phase2.current": 4.027,
      "grid.phase3.power": 715.4,
      "grid.phase3.voltage": 236.402,
      "grid.phase3.current": 3.03,
      // Wh -> kWh through `scale`, the same field a deciwatt register uses.
      "grid.energy.imported.total": 1234.567,
      "grid.energy.exported.total": 89,
      "grid.frequency": 50,
    });
  });

  test("the sample is stamped and coherent — one GET is one snapshot", async () => {
    const { source } = meter();

    const sample = await source.read();

    expect(Date.parse(sample.time)).toBeGreaterThan(0);
    // Neither flag: an HTTP body needs no atomic read planning, so there is no
    // skew to declare and no per-key time to report beyond the sample's own.
    expect(sample.degraded).toBeUndefined();
    expect(sample.readAt).toBeUndefined();
  });

  test("a component the device does not expose reads absent, not zero", async () => {
    // A monophase Pro 3EM answers `em1:0..2` and has no `em:0` at all. Every
    // pointer misses, and a meter reporting 0 W across a live house would be
    // acted on by the automation engines.
    const { source } = meter({ "em1:0": { act_power: 100 } });

    expect((await source.read()).metrics).toEqual({});
  });

  test("refuses a write without asking the device", async () => {
    const { source, requests } = meter();

    await expect(source.write("grid.power", 1)).rejects.toThrow("cannot write");
    expect(requests).toEqual([]);
  });
});
