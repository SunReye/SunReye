import { describe, expect, test } from "bun:test";

import { emptyForm } from "./device-form";
import {
  connectionProbeAnswer,
  describeConnectionProbe,
  describeProbe,
  probeTargetOf,
} from "./probe-logic";
import { NEW_CONNECTION } from "./device-types";
import type { ConnectionView } from "./device-types";

const gateway = {
  id: 3,
  name: "Gateway 1",
  kind: "modbus",
  params: {
    host: "10.0.0.5",
    port: 502,
    transport: "tcp",
    timeoutMs: 2000,
    pollIntervalMs: 1000,
  },
} satisfies ConnectionView;

/** A broker is a connection too since #217 — and not one a Modbus device sits on. */
const brokerConn = {
  id: 7,
  name: "Home broker",
  kind: "mqtt",
  params: { brokerUrl: "mqtt://hass.ee.lan:1883", hasPassword: false },
} satisfies ConnectionView;

describe("describeConnectionProbe", () => {
  test("each kind gets its own success line, with the time it took", () => {
    expect(describeConnectionProbe("modbus", { ok: true, ms: 12 })).toEqual({
      ok: true,
      message: "Reachable — port open, 12 ms.",
    });
    expect(describeConnectionProbe("mqtt", { ok: true, ms: 12 })).toEqual({
      ok: true,
      message: "Broker reachable — connected in 12 ms.",
    });
  });

  test("a failure carries its reason, whichever kind it was", () => {
    for (const kind of ["modbus", "mqtt"] as const) {
      expect(describeConnectionProbe(kind, { ok: false, ms: 4000, error: "timed out" })).toEqual({
        ok: false,
        message: "Unreachable: timed out",
      });
    }
  });

  test("a zero-millisecond success is still a success, not a falsy one", () => {
    expect(describeConnectionProbe("mqtt", { ok: true, ms: 0 }).ok).toBe(true);
  });

  /**
   * A Solarman probe learns something a TCP connect cannot: the logger stick
   * answers its handshake with its own serial, which is the field the operator
   * would otherwise have to read off a sticker behind the inverter. Saying the
   * number back is how they know the box found THEIR stick and not a neighbour's
   * — "reachable" alone is true of any port that is open.
   */
  test("a discovered logger serial is said back in the success line", () => {
    expect(describeConnectionProbe("modbus", { ok: true, ms: 12, serial: 1234567890 })).toEqual({
      ok: true,
      message: "Reachable — logger 1234567890 answered, 12 ms.",
    });
  });

  test("without one, the plain reachable line stands", () => {
    expect(describeConnectionProbe("modbus", { ok: true, ms: 12 }).message).toBe(
      "Reachable — port open, 12 ms.",
    );
  });
});

/**
 * The probe's answer as the describer takes it. The serial is the Solarman
 * addition: the server nests it under `logger` because a probe may one day
 * learn other things about the thing that answered, and a flat `serial` would
 * have to be renamed the day it does.
 */
describe("connectionProbeAnswer — the logger", () => {
  test("carries the serial the server discovered", () => {
    expect(connectionProbeAnswer({ ok: true, ms: 8, logger: { serial: 42 } }, "dead")).toEqual({
      ok: true,
      ms: 8,
      serial: 42,
    });
  });

  test.each([
    ["no logger at all — a plain TCP gateway", { ok: true, ms: 8 }],
    ["a logger block with no serial in it", { ok: true, ms: 8, logger: {} }],
    ["a serial that is not a number", { ok: true, ms: 8, logger: { serial: "1234" } }],
    ["a null logger", { ok: true, ms: 8, logger: null }],
  ])("states no serial for %s", (_label, data) => {
    expect(connectionProbeAnswer(data, "dead")).toEqual({ ok: true, ms: 8 });
  });

  test("a failure never carries one, whatever the body said", () => {
    expect(connectionProbeAnswer({ ok: false, ms: 4000, logger: { serial: 42 } }, "dead")).toEqual({
      ok: false,
      ms: 4000,
      error: "dead",
    });
  });
});

describe("describeProbe", () => {
  const words = {
    ok: (c: number, ms: number) => `${c} in ${ms}`,
    failed: (e: string) => `failed: ${e}`,
  };

  test("a good read reports metrics and time, defaulting absent numbers to 0", () => {
    expect(describeProbe({ ok: true, metricCount: 12, durationMs: 84 }, words)).toEqual({
      ok: true,
      message: "12 in 84",
    });
    expect(describeProbe({ ok: true }, words)).toEqual({
      ok: true,
      message: "0 in 0",
    });
  });

  test("a failure carries its reason, or an empty one", () => {
    expect(describeProbe({ ok: false, error: "timeout" }, words)).toEqual({
      ok: false,
      message: "failed: timeout",
    });
    expect(describeProbe({ ok: false }, words).message).toBe("failed: ");
  });
});

describe("probeTargetOf", () => {
  test("the chosen gateway's address with the form's unit id and profile", () => {
    const form = { ...emptyForm([gateway]), unitId: 3, profileId: "sdm630" };
    expect(probeTargetOf(form, [gateway])).toEqual({
      host: "10.0.0.5",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
      unitId: 3,
      profileId: "sdm630",
    });
  });

  test("a broker cannot be test-read — there is no register map on one", () => {
    expect(probeTargetOf({ ...emptyForm([brokerConn]), profileId: "p" }, [brokerConn])).toBeNull();
  });

  test("nothing to probe without a profile, or on a gateway that does not exist yet", () => {
    expect(probeTargetOf({ ...emptyForm([gateway]), profileId: "" }, [gateway])).toBeNull();
    expect(probeTargetOf({ ...emptyForm([]), profileId: "p" }, [])).toBeNull();
    expect(
      probeTargetOf(
        {
          ...emptyForm([gateway]),
          connectionChoice: NEW_CONNECTION,
          profileId: "p",
        },
        [gateway],
      ),
    ).toBeNull();
  });
});

/**
 * WHAT HANGS OFF A CONNECTION, beside what reads through it.
 *
 * An integration is a row of its own now (`integrations`, migration 0007), and
 * the page that answers "what is on this endpoint" has to show both halves: the
 * devices reached THROUGH the connection, and the integrations that sit ON it.
 * Before this they were on a separate tab, so an operator looking at a broker
 * saw its loadpoints and no sign of the EVCC ingest that provisioned them.
 */
