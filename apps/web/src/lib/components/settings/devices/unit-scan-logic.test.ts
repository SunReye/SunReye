import { describe, expect, test } from "bun:test";

import { emptyForm } from "./add-device-logic";
import { NEW_CONNECTION, type ConnectionView } from "./device-types";
import { blankDraft } from "./connection-draft";
import {
  chosenModbusParams,
  configScanTarget,
  describeUnitScan,
  scanOutcome,
  scanTargetOf,
  unitIdHelp,
  type UnitScanAnswer,
} from "./unit-scan-logic";

const GATEWAY_PARAMS = {
  host: "10.20.0.62",
  port: 502,
  transport: "tcp",
  timeoutMs: 4000,
  pollIntervalMs: 1000,
} as const;

const gateway = {
  id: 1,
  name: "Gateway",
  kind: "modbus",
  params: { ...GATEWAY_PARAMS },
  deviceCount: 0,
} as unknown as ConnectionView;

const WORDS = {
  found: ({ unitId, ms }: { unitId: number; ms: number }) => `found ${unitId} in ${ms} ms`,
  none: ({ ids }: { ids: string }) => `nothing on ${ids}`,
};

describe("scanTargetOf", () => {
  test("names the chosen gateway's address and the chosen profile", () => {
    const form = { ...emptyForm([gateway]), profileId: "deye" };

    expect(scanTargetOf(form, [gateway])).toEqual({
      kind: "modbus",
      params: { ...GATEWAY_PARAMS },
      profileId: "deye",
    });
  });

  // The wizard asks for the endpoint in step 1 and the profile in step 3, so by
  // the time the scan button exists the address is a DRAFT, not a row. Refusing
  // to scan there would withhold the button from exactly the operator who has
  // never typed a unit id before.
  test("scans the draft address when the gateway is still being created", () => {
    const form = { ...emptyForm([], [], NEW_CONNECTION), profileId: "deye" };
    form.newConnection.modbus.host = "10.20.0.63";
    form.newConnection.modbus.transport = "solarman-v5";
    form.newConnection.modbus.port = 8899;

    expect(scanTargetOf(form, [])).toMatchObject({
      kind: "modbus",
      params: { host: "10.20.0.63", port: 8899, transport: "solarman-v5" },
      profileId: "deye",
    });
  });

  // The wizard's step 1 edits an endpoint of its own; the form it seeds carries a
  // blank one. Without the override the create arm would scan nothing.
  test("prefers the wizard's own draft over the form's blank one", () => {
    const form = { ...emptyForm([], [], NEW_CONNECTION), profileId: "deye" };
    const wizardDraft = blankDraft("Gateway 1");
    wizardDraft.modbus.host = "10.20.0.62";

    expect(scanTargetOf(form, [], wizardDraft)).toMatchObject({
      params: { host: "10.20.0.62" },
    });
    expect(chosenModbusParams(form, [], wizardDraft)?.transport).toBe("tcp");
  });

  test("cannot scan without a profile — there is no register map to ask with", () => {
    expect(scanTargetOf(emptyForm([gateway]), [gateway])).toBeNull();
  });

  test("cannot scan a draft with no host yet", () => {
    const form = { ...emptyForm([], [], NEW_CONNECTION), profileId: "deye" };

    expect(scanTargetOf(form, [])).toBeNull();
  });
});

describe("configScanTarget", () => {
  const cfg = {
    host: "10.20.0.63",
    port: 8899,
    transport: "solarman-v5" as const,
    unitId: 0,
    timeoutMs: 3000,
    pollIntervalMs: 2000,
    simulate: false,
  };

  test("scans the address the onboarding form holds, with the chosen profile", () => {
    expect(configScanTarget(cfg, "deye")).toEqual({
      kind: "modbus",
      params: {
        host: "10.20.0.63",
        port: 8899,
        transport: "solarman-v5",
        timeoutMs: 3000,
        pollIntervalMs: 2000,
      },
      profileId: "deye",
    });
  });

  test("carries a configured logger serial, and omits it when there is none", () => {
    expect(configScanTarget({ ...cfg, loggerSerial: 3168930341 }, "deye")?.params).toMatchObject({
      loggerSerial: 3168930341,
    });
    expect(configScanTarget(cfg, "deye")?.params).not.toHaveProperty("loggerSerial");
  });

  test("cannot scan without an address or without a profile", () => {
    expect(configScanTarget({ ...cfg, host: "  " }, "deye")).toBeNull();
    expect(configScanTarget(cfg, null)).toBeNull();
  });
});

describe("describeUnitScan", () => {
  test("names the id that answered, and how long it took", () => {
    const answer: UnitScanAnswer = { scanned: [1, 0], found: { unitId: 0, ms: 1 } };

    expect(describeUnitScan(answer, WORDS)).toEqual({
      ok: true,
      unitId: 0,
      message: "found 0 in 1 ms",
    });
  });

  test("lists every id it ruled out when nothing answered", () => {
    const answer: UnitScanAnswer = { scanned: [1, 0, 2], found: null };

    expect(describeUnitScan(answer, WORDS)).toEqual({
      ok: false,
      unitId: undefined,
      message: "nothing on 1, 0, 2",
    });
  });
});

describe("scanOutcome", () => {
  test("reads the route's answer", () => {
    const answer = { scanned: [1], found: { unitId: 1, ms: 82 } };

    expect(scanOutcome(answer, null, WORDS, "request failed")).toEqual({
      ok: true,
      unitId: 1,
      message: "found 1 in 82 ms",
    });
  });

  // A refused scan — a profile this build cannot resolve, an endpoint that never
  // opened — is a reason the operator can act on, and it arrives in the BODY of
  // a 400. It must never be rendered as the id was found, and never as
  // "[object Object]".
  test("reports a refusal with the server's own reason, and finds no id", () => {
    const outcome = scanOutcome(
      undefined,
      { value: { error: "connect to 10.20.0.99:502 timed out" } },
      WORDS,
      "request failed",
    );

    expect(outcome).toEqual({
      ok: false,
      unitId: undefined,
      message: "connect to 10.20.0.99:502 timed out",
    });
  });

  test("falls back when the request itself never answered", () => {
    expect(scanOutcome(undefined, null, WORDS, "request failed").message).toBe("request failed");
  });
});

describe("unitIdHelp", () => {
  // The two framings mean DIFFERENT things by this number, measured on one
  // plant's own two paths to one inverter: the gateway answers unit 0 and times
  // out on 1, the stick answers 1 and times out on 0.
  test("a bus framing addresses the inverter's own slave id", () => {
    expect(unitIdHelp("solarman-v5")).toBe(unitIdHelp("rtu-over-tcp"));
    expect(unitIdHelp("solarman-v5")).not.toBe(unitIdHelp("tcp"));
  });

  test("an unknown framing says nothing rather than guessing", () => {
    expect(unitIdHelp(null)).toBeNull();
  });
});
