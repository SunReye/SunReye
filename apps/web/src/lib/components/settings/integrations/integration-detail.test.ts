/**
 * The integration detail page's decisions.
 *
 * The page itself is a rendering; these are what it renders. Every case here is
 * a state an operator can genuinely be in and be told the wrong thing about: a
 * broker that has never connected once, a broker that connected and then failed,
 * and a row this process is holding no client for at all — which is NOT "down",
 * and painting it as such would be a measurement the server never made.
 */

import { describe, expect, test } from "bun:test";
import {
  deviceAddress,
  findIntegration,
  integrationReadings,
  integrationStatus,
} from "./integration-detail";
import type { ConnectionStatus, DeviceView, IntegrationView } from "../devices/device-types";

const integration = (over: Partial<IntegrationView> = {}): IntegrationView => ({
  id: 1,
  kind: "evcc-ingest",
  connectionId: 2,
  enabled: true,
  params: { topicRoot: "evcc" },
  label: "EVCC",
  addable: true,
  multiInstance: true,
  status: null,
  ...over,
});

const status = (over: Partial<ConnectionStatus> = {}): ConnectionStatus => ({
  connected: true,
  lastError: null,
  lastErrorAt: null,
  lastConnectedAt: "2026-09-10T08:00:00.000Z",
  ...over,
});

const device = (over: Partial<DeviceView> = {}): DeviceView => ({
  id: 4,
  slug: "evcc-loadpoint-1",
  name: "Carport",
  profileId: "evcc-loadpoint",
  role: "charger",
  unitId: 0,
  connectionId: 2,
  retiredAt: null,
  connection: null,
  arrays: [],
  tempCoefficient: -0.4,
  systemLoss: 14,
  battery: null,
  profileName: "EVCC loadpoint",
  profileKnown: true,
  kind: "coded",
  state: "provided",
  integration: "evcc",
  ...over,
});

describe("integrationStatus", () => {
  test("an open connection is the only thing painted healthy", () => {
    const view = integrationStatus(integration({ status: status() }));
    expect(view.ok).toBe(true);
    expect(view.observed).toBe(true);
    expect(view.label).toBe("Connected");
    expect(view.lastConnectedAt).toBe("2026-09-10T08:00:00.000Z");
  });

  // Two different faults with two different fixes: a broker that has gone away,
  // versus one these credentials were never able to reach. An operator told the
  // wrong one looks in the wrong place.
  test("a connection that has never opened says so, not merely 'not connected'", () => {
    const view = integrationStatus(
      integration({ status: status({ connected: false, lastConnectedAt: null }) }),
    );
    expect(view.ok).toBe(false);
    expect(view.observed).toBe(true);
    expect(view.label).toBe("Never connected");
  });

  test("a connection that has dropped since is 'not connected'", () => {
    const view = integrationStatus(integration({ status: status({ connected: false }) }));
    expect(view.label).toBe("Not connected");
    expect(view.lastConnectedAt).toBe("2026-09-10T08:00:00.000Z");
  });

  // The reason the page shows an error at all: `connected` alone leaves an
  // operator with a red pill and nothing to act on.
  test("the last failure is carried through with the moment it happened", () => {
    const view = integrationStatus(
      integration({
        status: status({
          connected: false,
          lastError: "ECONNREFUSED hass.ee.lan:1883",
          lastErrorAt: "2026-09-10T09:30:00.000Z",
        }),
      }),
    );
    expect(view.lastError).toBe("ECONNREFUSED hass.ee.lan:1883");
    expect(view.lastErrorAt).toBe("2026-09-10T09:30:00.000Z");
  });

  // NULL IS NOT DOWN. It is "this process holds no client for that row" — an
  // integration on no connection, a `modbus` row the poll loop still owns, or a
  // boot that has opened nothing yet.
  test("an unobserved row is neither healthy nor reported as a failure", () => {
    const view = integrationStatus(integration({ status: null }));
    expect(view.ok).toBe(false);
    expect(view.observed).toBe(false);
    expect(view.label).toBe("Not observed by this server");
    expect(view.lastError).toBeNull();
    expect(view.lastErrorAt).toBeNull();
    expect(view.lastConnectedAt).toBeNull();
  });

  // A healthy connection that has failed in the past keeps the error: it is the
  // whole content of "it reconnects every ten minutes".
  test("an error survives a reconnect", () => {
    const view = integrationStatus(
      integration({
        status: status({ lastError: "socket hang up", lastErrorAt: "2026-09-09T00:00:00.000Z" }),
      }),
    );
    expect(view.ok).toBe(true);
    expect(view.lastError).toBe("socket hang up");
  });
});

describe("findIntegration", () => {
  const rows = [integration(), integration({ id: 2, kind: "ha-export", label: "HA" })];

  test("finds the row the route parameter names", () => {
    expect(findIntegration(rows, "2")?.label).toBe("HA");
  });

  // The id comes off a URL, so every one of these is reachable by typing.
  test.each([["9"], ["abc"], [""], ["1.5"], [undefined]])(
    "gives nothing for %p rather than a wrong row",
    (id) => {
      expect(findIntegration(rows, id as string | undefined)).toBeNull();
    },
  );

  test("gives nothing when the list has not arrived yet", () => {
    expect(findIntegration([], "1")).toBeNull();
  });
});

describe("deviceAddress", () => {
  // Three kinds, three genuinely different answers — and the middle one is the
  // point: a loadpoint's `unit_id` is its index in EVCC's config, not a slave
  // id on a wire, and calling both "Unit" is what made the roster read as a
  // column dump.
  test("a Modbus device is addressed by its slave id", () => {
    expect(deviceAddress(device({ kind: "modbus", unitId: 2 }))).toBe("Unit 2");
  });

  test("a coded device is addressed by its index in the integration's config", () => {
    expect(deviceAddress(device({ kind: "coded", unitId: 1 }))).toBe("Index 1");
  });

  test("an internal device is addressed by nothing at all", () => {
    expect(deviceAddress(device({ kind: "virtual" }))).toBe("Internal");
  });
});

describe("integrationReadings", () => {
  /**
   * The one live value an EVCC ingest can honestly claim.
   *
   * `$lib/live/ownership.ts` names plant-wide ids only, so this is every
   * loadpoint's power summed — which is why it is the INTEGRATION's reading and
   * not each device's. Reaching past `livePlant` into the EVCC store for a
   * per-loadpoint number is the cross-topic merge that table exists to forbid.
   */
  test("an EVCC ingest reports its charge power, under its owned id", () => {
    expect(integrationReadings(integration())).toEqual([
      { id: "evcc.charge.power", label: expect.any(Function), unit: "W" },
    ]);
    expect(integrationReadings(integration())[0]!.label()).toBe("Charge power");
  });

  // The Home Assistant export publishes and measures nothing. An empty tile
  // would claim it has a number that has not arrived.
  test("an integration that measures nothing reports nothing", () => {
    expect(integrationReadings(integration({ kind: "ha-export" }))).toEqual([]);
  });

  test("a kind this build has no table entry for reports nothing", () => {
    expect(integrationReadings(integration({ kind: "from-the-future" }))).toEqual([]);
  });
});
