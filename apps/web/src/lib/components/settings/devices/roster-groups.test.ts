import { describe, expect, test } from "bun:test";

import {
  type DeviceGroup,
  groupByConnection,
  groupIsEmpty,
  nestIntegrations,
  retiredByRemoving,
  splitRetired,
} from "./roster-groups";
import type { ConnectionView, DeviceView, IntegrationView } from "./device-types";

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

const device = (over: Partial<DeviceView>): DeviceView => ({
  id: 1,
  slug: "inverter",
  name: "Inverter",
  profileId: "deye",
  role: "inverter",
  unitId: 1,
  connectionId: 3,
  params: {},
  retiredAt: null,
  connection: gateway,
  arrays: [],
  tempCoefficient: -0.4,
  systemLoss: 14,
  battery: null,
  profileName: "Deye",
  profileKnown: true,
  kind: "modbus",
  state: "polling",
  integration: null,
  ...over,
});

/** An EVCC loadpoint: MQTT-fed, so no gateway, no unit, no installed profile. */
const loadpoint = (over: Partial<DeviceView> = {}): DeviceView =>
  device({
    id: 10,
    slug: "evcc-loadpoint-1",
    name: "Carport",
    profileId: "evcc-loadpoint",
    role: "charger",
    unitId: 0,
    connectionId: null,
    connection: null,
    profileName: "EVCC loadpoint",
    kind: "coded",
    state: "provided",
    integration: "evcc",
    ...over,
  });

/** The optimizer: coded as well, but virtual — it belongs under Internal. */
const optimizerDevice = (over: Partial<DeviceView> = {}): DeviceView =>
  device({
    id: 11,
    slug: "optimizer",
    name: "Optimizer",
    profileId: "sunreye.optimizer",
    role: "optimizer",
    unitId: 0,
    connectionId: null,
    connection: null,
    profileName: "SunReye Optimizer",
    kind: "virtual",
    state: "virtual",
    integration: "optimizer",
    ...over,
  });

describe("groupByConnection", () => {
  const other = {
    ...gateway,
    id: 4,
    name: "Keller",
    params: { ...gateway.params, host: "10.0.0.9" },
  } satisfies ConnectionView;
  const devices = [
    device({ id: 1, slug: "inv", connectionId: 3 }),
    device({ id: 2, slug: "sim", connectionId: null, connection: null }),
    device({ id: 3, slug: "meter", connectionId: 3 }),
    device({ id: 4, slug: "hp", connectionId: 4, connection: other }),
  ];

  test("one group per connection in id order, its devices in roster order, endpoint-less last", () => {
    const groups = groupByConnection({
      connections: [other, gateway],
      devices,
    });
    expect(groups.map((g) => [g.connection?.id ?? null, g.devices.map((d) => d.slug)])).toEqual([
      [3, ["inv", "meter"]],
      [4, ["hp"]],
      [null, ["sim"]],
    ]);
  });

  test("a connection with no devices is still a group — that is the one that can be deleted", () => {
    const groups = groupByConnection({
      connections: [gateway, other],
      devices: [devices[0]!],
    });
    expect(groups.map((g) => [g.connection?.id ?? null, g.devices.length])).toEqual([
      [3, 1],
      [4, 0],
    ]);
  });

  test("no endpoint-less group when every device has a gateway", () => {
    const groups = groupByConnection({
      connections: [gateway],
      devices: [devices[0]!],
    });
    expect(groups.some((g) => g.kind === "orphan")).toBe(false);
  });

  // #213: every `connectionId === null` device fell into ONE orphan group, so a
  // loadpoint and the optimizer sat under "No connection" beside a simulated
  // inverter — three unrelated reasons for having no gateway, told as one.
  test("a coded device is grouped under its integration, not under No connection", () => {
    const groups = groupByConnection({
      connections: [gateway],
      devices: [devices[0]!, loadpoint(), loadpoint({ id: 12, slug: "evcc-loadpoint-2" })],
    });
    expect(groups.map((g) => [g.kind, g.title, g.devices.map((d) => d.slug)])).toEqual([
      ["gateway", "Gateway 1", ["inv"]],
      ["integration", "EVCC", ["evcc-loadpoint-1", "evcc-loadpoint-2"]],
    ]);
  });

  test("the optimizer is internal — virtual outranks its coded declaration", () => {
    const groups = groupByConnection({
      connections: [],
      devices: [optimizerDevice()],
    });
    expect(groups.map((g) => [g.kind, g.devices.map((d) => d.slug)])).toEqual([
      ["internal", ["optimizer"]],
    ]);
  });

  test("gateways first, then each integration by name, then Internal, then the true orphans", () => {
    const groups = groupByConnection({
      connections: [other, gateway],
      devices: [
        device({ id: 1, slug: "inv", connectionId: 3 }),
        optimizerDevice(),
        loadpoint(),
        device({ id: 2, slug: "sim", connectionId: null, connection: null }),
        loadpoint({ id: 13, slug: "zoe", integration: "zoe-cloud", profileName: "Zoe" }),
      ],
    });
    expect(groups.map((g) => g.kind)).toEqual([
      "gateway",
      "gateway",
      "integration",
      "integration",
      "internal",
      "orphan",
    ]);
    // An integration this build has no label for shows as its own name rather
    // than as nothing: the group is data, not a branch.
    expect(groups.map((g) => g.title)).toEqual([
      "Gateway 1",
      "Keller",
      "EVCC",
      "zoe-cloud",
      "Internal",
      "No connection",
    ]);
    expect(groups.at(-1)!.devices.map((d) => d.slug)).toEqual(["sim"]);
  });

  /**
   * #217: the loadpoints are BOUND to their broker now, so they belong to that
   * connection's group and not to an "Integrations" group beside it. Before the
   * schema change they sat at `connection_id = null` and shared `unit_id = 0`,
   * which the `devices(connection_id, unit_id)` unique index tolerated only
   * because the connection was null.
   */
  test("loadpoints on a broker sit under that broker, not in an integration group", () => {
    const groups = groupByConnection({
      connections: [gateway, brokerConn],
      devices: [
        device({ id: 1, slug: "inv", connectionId: 3 }),
        loadpoint({ id: 20, slug: "evcc-loadpoint-1", connectionId: 7, unitId: 0 }),
        loadpoint({ id: 21, slug: "evcc-loadpoint-2", connectionId: 7, unitId: 1 }),
        optimizerDevice(),
        device({ id: 30, slug: "sim", connectionId: null, connection: null }),
      ],
    });
    expect(groups.map((g) => [g.kind, g.title, g.caption, g.devices.map((d) => d.slug)])).toEqual([
      ["gateway", "Gateway 1", "Modbus TCP · 10.0.0.5:502 · every 1\u00a0s", ["inv"]],
      ["gateway", "Home broker", "MQTT · hass.ee.lan", ["evcc-loadpoint-1", "evcc-loadpoint-2"]],
      ["internal", "Internal", null, ["optimizer"]],
      ["orphan", "No connection", null, ["sim"]],
    ]);
    // Nothing is left over for an integration group: the endpoint is the group.
    expect(groups.some((g) => g.kind === "integration")).toBe(false);
  });

  test("a retired coded device still groups under its integration", () => {
    const groups = groupByConnection({
      connections: [],
      devices: [loadpoint({ state: "retired", retiredAt: "2026-01-01T00:00:00.000Z" })],
    });
    expect(groups.map((g) => g.kind)).toEqual(["integration"]);
  });
});

// The group is labelled by its KIND (#217): a gateway says how it is framed and
// how often it is read, a broker says which broker it is. Read through the
// group, because that is the only thing that renders it — a `kind = 'mqtt'`
// group used to be impossible, and rendering the Modbus caption for one would
// read "undefined:undefined · every NaN s".
describe("a group's caption", () => {
  const captionOf = (connection: ConnectionView) =>
    groupByConnection({ connections: [connection], devices: [] })[0]!.caption;

  test("a gateway spells transport, address and cadence in seconds", () => {
    expect(captionOf(gateway)).toBe("Modbus TCP · 10.0.0.5:502 · every 1\u00a0s");
    expect(
      captionOf({
        ...gateway,
        params: { ...gateway.params, transport: "rtu-over-tcp", pollIntervalMs: 2500 },
      }),
    ).toBe("Modbus RTU over TCP · 10.0.0.5:502 · every 2.5\u00a0s");
  });

  // The third framing reads as itself, from the same table the select spends —
  // the caption used to carry its own two-entry copy, so a Solarman gateway
  // would have been captioned "solarman-v5 · 10.0.0.5:8899".
  test("a Solarman gateway spells the logger framing, not its wire value", () => {
    expect(
      captionOf({
        ...gateway,
        params: { ...gateway.params, transport: "solarman-v5", port: 8899 },
      }),
    ).toBe("Solarman V5 (logger stick, port 8899) · 10.0.0.5:8899 · every 1 s");
  });

  test("a broker spells MQTT and the broker's host, scheme and port dropped", () => {
    expect(captionOf(brokerConn)).toBe("MQTT · hass.ee.lan");
  });

  test("a broker with no URL yet still reads as MQTT", () => {
    expect(captionOf({ ...brokerConn, params: { brokerUrl: "", hasPassword: false } })).toBe(
      "MQTT · ",
    );
  });

  test("only a connection group has one", () => {
    const groups = groupByConnection({ connections: [], devices: [optimizerDevice()] });
    expect(groups[0]!.caption).toBeNull();
  });
});

/**
 * A gateway's success says its PORT is open; a broker's says it accepted an
 * MQTT CONNECT. Reporting the Modbus wording for a broker would tell the
 * operator it is reachable when their password is what is broken — a TCP
 * connect to a broker's port succeeds for every broker that is running.
 */
describe("the integrations a group carries", () => {
  const broker = brokerConn;
  const integration = (over: Partial<IntegrationView> = {}): IntegrationView => ({
    id: 1,
    kind: "evcc-ingest",
    connectionId: 7,
    enabled: true,
    params: { topicRoot: "evcc" },
    label: "EVCC",
    addable: true,
    multiInstance: true,
    status: null,
    ...over,
  });

  test("an integration is listed under the connection it names", () => {
    const groups = groupByConnection({
      connections: [gateway, broker],
      devices: [],
      integrations: [integration(), integration({ id: 2, kind: "ha-export", label: "HA" })],
    });
    expect(groups.map((g) => [g.title, g.integrations.map((i) => i.id)])).toEqual([
      ["Gateway 1", []],
      ["Home broker", [1, 2]],
    ]);
  });

  // A row with no connection is a coded thing running over no endpoint at all —
  // the catalog's null arm. "Internal" is where the devices of that shape
  // already live, so it is where the integrations of that shape belong too.
  test("a connection-less integration belongs to Internal", () => {
    const groups = groupByConnection({
      connections: [gateway],
      devices: [optimizerDevice()],
      integrations: [integration({ id: 5, connectionId: null, kind: "sunreye.optimizer" })],
    });
    expect(groups.map((g) => [g.kind, g.integrations.map((i) => i.id)])).toEqual([
      ["gateway", []],
      ["internal", [5]],
    ]);
  });

  // Internal used to exist only while it held a DEVICE. A connection-less
  // integration with no device would then have nowhere to be rendered at all —
  // configured, running, and invisible.
  test("Internal appears for a connection-less integration even with no device in it", () => {
    const groups = groupByConnection({
      connections: [],
      devices: [],
      integrations: [integration({ id: 5, connectionId: null })],
    });
    expect(groups.map((g) => [g.kind, g.devices.length, g.integrations.length])).toEqual([
      ["internal", 0, 1],
    ]);
  });

  // The devices a coded integration provisioned are grouped by their OWN
  // `connectionId`, which is the integration's; the two halves of the card are
  // read off different roster arms and must not be conflated.
  test("a broker's card holds both what it provisions and what reads through it", () => {
    const groups = groupByConnection({
      connections: [broker],
      devices: [loadpoint({ id: 20, slug: "evcc-loadpoint-1", connectionId: 7, unitId: 0 })],
      integrations: [integration()],
    });
    expect(groups[0]!.devices.map((d) => d.slug)).toEqual(["evcc-loadpoint-1"]);
    expect(groups[0]!.integrations.map((i) => i.label)).toEqual(["EVCC"]);
  });

  // The page loads the roster and the integration list separately, so it renders
  // once with the devices and no rows yet. That is an empty list, never a crash.
  test("a roster with no integration list at all carries empty lists", () => {
    const groups = groupByConnection({ connections: [gateway], devices: [] });
    expect(groups.map((g) => g.integrations)).toEqual([[]]);
  });

  // Both halves empty is the only thing that makes a card empty. A gateway with
  // no devices but an integration on it has something to show.
  test("a group is empty only when neither half holds anything", () => {
    const withRow = groupByConnection({
      connections: [broker],
      devices: [],
      integrations: [integration()],
    });
    expect(groupIsEmpty(withRow[0]!)).toBe(false);
    const bare = groupByConnection({ connections: [broker], devices: [] });
    expect(groupIsEmpty(bare[0]!)).toBe(true);
  });
});

/**
 * WHAT A REMOVE TAKES WITH IT.
 *
 * `DELETE /api/integrations/:id` retires the devices the integration
 * provisioned — an EVCC ingest's loadpoints — because their readings are a
 * foreign key away from a year of `metrics_raw` rows and deleting them would
 * take the history with it (`integration-admin.ts`, `retireYielded`). The
 * confirm dialog has to SAY so: a Remove that silently retires two chargers is
 * the wrong surprise, and the operator cannot see it coming from the row.
 *
 * Mirrors the server's `YIELDED_PROFILES` table, and is a TABLE here for the
 * same reason: an integration that yields nothing is absent from it, so the
 * dialog for a Home Assistant export names nothing rather than branching.
 */
describe("retiredByRemoving", () => {
  const broker = brokerConn;
  const ingest = {
    id: 1,
    kind: "evcc-ingest",
    connectionId: 7,
    enabled: true,
    params: {},
    label: "EVCC",
    addable: true,
    multiInstance: true,
    status: null,
  } satisfies IntegrationView;
  const onBroker = (over: Partial<DeviceView> = {}) =>
    loadpoint({ connectionId: 7, connection: broker, ...over });

  test("an EVCC ingest names the live loadpoints on its own broker", () => {
    expect(
      retiredByRemoving(ingest, [
        onBroker({ id: 20, slug: "evcc-loadpoint-1", name: "Carport" }),
        onBroker({ id: 21, slug: "evcc-loadpoint-2", name: "Garage" }),
      ]).map((d) => d.name),
    ).toEqual(["Carport", "Garage"]);
  });

  // Its own broker, and no other's: two EVCC instances on two brokers is the
  // arrangement the connection column made expressible, and removing one must
  // not claim the other's chargers.
  test("a loadpoint on another broker is not this integration's to retire", () => {
    expect(
      retiredByRemoving(ingest, [onBroker({ id: 22, connectionId: 9, slug: "other" })]),
    ).toEqual([]);
  });

  // `retired_at` is when the device left service, and the server skips a row
  // that already has one rather than re-stamping it. Naming it in the dialog
  // would promise a change that will not happen.
  test("an already-retired loadpoint is not named again", () => {
    expect(
      retiredByRemoving(ingest, [onBroker({ id: 23, retiredAt: "2026-01-01T00:00:00.000Z" })]),
    ).toEqual([]);
  });

  test("only the profiles the integration provisions, never every device on the broker", () => {
    expect(
      retiredByRemoving(ingest, [
        onBroker({ id: 24, slug: "meter", profileId: "sungrow-sh10rt", kind: "modbus" }),
      ]),
    ).toEqual([]);
  });

  // The Home Assistant export publishes and provisions nothing, so its Remove
  // is just a Remove — and it is absent from the table rather than special-cased.
  test("an integration that provisions nothing retires nothing", () => {
    expect(
      retiredByRemoving({ ...ingest, kind: "ha-export" }, [
        onBroker({ id: 25, slug: "evcc-loadpoint-1" }),
      ]),
    ).toEqual([]);
  });
});

/**
 * NESTING — the shape the owner asked for, and the complaint it answers.
 *
 * The shipped card listed `Carport` (a loadpoint) above `EVCC` (the ingest that
 * discovered it) as unrelated siblings, with a "via MQTT" badge as the only
 * hint that one exists BECAUSE of the other. So a device an integration
 * provided belongs UNDER that integration, and only the devices read directly
 * through the endpoint stay at the top of the card.
 *
 * The link is `YIELDED_PROFILES` — already the web mirror of the server's own
 * table, and already what `retiredByRemoving` decides from. One rule, two
 * readers: a second "which devices does this integration provide" would be free
 * to disagree with the confirm dialog about what a Remove takes with it.
 */
describe("nestIntegrations", () => {
  const broker = brokerConn;
  const ingest = (over: Partial<IntegrationView> = {}): IntegrationView => ({
    id: 1,
    kind: "evcc-ingest",
    connectionId: 7,
    enabled: true,
    params: {},
    label: "EVCC",
    addable: true,
    multiInstance: true,
    status: null,
    ...over,
  });
  const onBroker = (over: Partial<DeviceView> = {}) =>
    loadpoint({ connectionId: 7, connection: broker, ...over });
  const group = (over: Partial<DeviceGroup> = {}): DeviceGroup => ({
    key: "gateway-7",
    kind: "gateway",
    title: "Home broker",
    caption: null,
    connection: broker,
    integration: null,
    devices: [],
    integrations: [],
    ...over,
  });

  test("a loadpoint moves under the ingest that provided it", () => {
    const carport = onBroker({ id: 20, slug: "evcc-loadpoint-1", name: "Carport" });
    const nested = nestIntegrations(group({ devices: [carport], integrations: [ingest()] }));
    expect(nested.devices).toEqual([]);
    expect(
      nested.integrations.map((row) => [row.integration.id, row.devices.map((d) => d.name)]),
    ).toEqual([[1, ["Carport"]]]);
  });

  // A Modbus device on a gateway is READ through the endpoint; nothing provided
  // it, and burying it under an integration would be a second lie in place of
  // the first.
  test("a device read directly through the connection stays at the top", () => {
    const meter = device({ id: 2, slug: "meter", connectionId: 7, connection: broker });
    const nested = nestIntegrations(group({ devices: [meter], integrations: [ingest()] }));
    expect(nested.devices.map((d) => d.slug)).toEqual(["meter"]);
    expect(nested.integrations[0]!.devices).toEqual([]);
  });

  // The card must keep showing a retired loadpoint — a device nobody can see is
  // a device nobody can restore — and it belongs under its provider like any
  // other. `retiredByRemoving` drops it because the SERVER skips it; that is a
  // question about a delete, not about where a row is drawn.
  test("a retired loadpoint is still the integration's, unlike what a Remove would retire", () => {
    const gone = onBroker({
      id: 21,
      slug: "evcc-loadpoint-2",
      retiredAt: "2026-01-01T00:00:00.000Z",
    });
    const nested = nestIntegrations(group({ devices: [gone], integrations: [ingest()] }));
    expect(nested.integrations[0]!.devices.map((d) => d.id)).toEqual([21]);
    expect(nested.devices).toEqual([]);
    expect(retiredByRemoving(ingest(), [gone])).toEqual([]);
  });

  // An integration that yields nothing (the Home Assistant export publishes and
  // provisions nothing) is a row with no children — not a row that swallows
  // whatever else is on the broker.
  test("an integration that provisions nothing owns nothing", () => {
    const carport = onBroker({ id: 20 });
    const nested = nestIntegrations(
      group({
        devices: [carport],
        integrations: [ingest({ id: 3, kind: "ha-export", label: "HA" })],
      }),
    );
    expect(nested.integrations[0]!.devices).toEqual([]);
    // …and the loadpoint is not silently hidden: with no provider on this card
    // it stays visible at the top, where it was before.
    expect(nested.devices.map((d) => d.id)).toEqual([20]);
  });

  /**
   * TWO EVCC ingests on ONE broker is expressible — the entry is
   * `multiInstance` — and `YIELDED_PROFILES` cannot tell their loadpoints
   * apart: both claim the same profile on the same connection. A device drawn
   * twice is a roster that reports more chargers than the plant has, so it is
   * claimed by the FIRST row in list order and by that one only.
   */
  test("two ingests on one broker do not both claim the same loadpoint", () => {
    const carport = onBroker({ id: 20 });
    const nested = nestIntegrations(
      group({ devices: [carport], integrations: [ingest(), ingest({ id: 2 })] }),
    );
    expect(nested.integrations.map((row) => row.devices.map((d) => d.id))).toEqual([[20], []]);
  });

  test("an empty card nests nothing and hides nothing", () => {
    expect(nestIntegrations(group())).toEqual({ devices: [], integrations: [] });
  });
});

const retiredRow = (id: number, retiredAt: string | null = null) =>
  ({ id, retiredAt }) as DeviceView;

describe("the retired devices fold away under their own disclosure", () => {
  test("splits in service from retired, keeping the order of each", () => {
    const rows = [
      retiredRow(1),
      retiredRow(2, "2026-01-01"),
      retiredRow(3),
      retiredRow(4, "2026-02-01"),
    ];
    const { active, retired } = splitRetired(rows);
    expect(active.map((d) => d.id)).toEqual([1, 3]);
    expect(retired.map((d) => d.id)).toEqual([2, 4]);
  });

  test("an empty list is two empty halves", () => {
    expect(splitRetired([])).toEqual({ active: [], retired: [] });
  });
});
