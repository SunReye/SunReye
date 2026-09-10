import { describe, expect, test } from "bun:test";

import {
  type CatalogEntryView,
  type WizardState,
  advance,
  blockedAt,
  emptyWizard,
  entriesFor,
  goBack,
  submissionOf,
  wizardKind,
} from "./add-wizard";

const catalog = {
  modbus: [
    {
      id: "modbus-device",
      label: "Modbus device",
      via: "profile",
      addable: true,
      multiInstance: true,
      fields: [],
    },
  ],
  mqtt: [
    {
      id: "evcc-ingest",
      label: "EVCC",
      via: "coded",
      addable: true,
      multiInstance: true,
      fields: [
        { name: "topicRoot", type: "string", required: false, default: "evcc", min: 1, max: 120 },
      ],
    },
    {
      id: "ha-export",
      label: "Home Assistant",
      via: "coded",
      addable: true,
      multiInstance: false,
      fields: [
        { name: "topicPrefix", type: "string", required: false, default: "sunreye" },
        { name: "haDiscoveryEnabled", type: "boolean", required: false, default: false },
      ],
    },
  ],
  internal: [
    {
      id: "sunreye.optimizer",
      label: "SunReye Optimizer",
      via: "coded",
      addable: false,
      multiInstance: false,
      fields: [],
    },
  ],
} satisfies Record<string, CatalogEntryView[]>;

const connections = [
  { id: 1, name: "Inverter", kind: "modbus" as const },
  { id: 2, name: "Broker", kind: "mqtt" as const },
];

const at = (over: Partial<WizardState> = {}): WizardState => ({ ...emptyWizard(), ...over });

describe("which connection the wizard is working on", () => {
  test("an existing connection contributes its kind", () => {
    const state = at({ connection: { mode: "existing", id: 2 } });
    expect(wizardKind(state, connections)).toBe("mqtt");
  });

  // The kind is the catalog's key, and a connection being CREATED has one
  // before it exists — otherwise step 2 could not be reached without a save.
  test("a connection being created contributes the kind it is being created as", () => {
    const state = at({ connection: { mode: "create", kind: "mqtt" } });
    expect(wizardKind(state, connections)).toBe("mqtt");
  });

  test("no connection, and an id naming none, both mean no kind", () => {
    expect(wizardKind(at(), connections)).toBeNull();
    expect(wizardKind(at({ connection: { mode: "existing", id: 99 } }), connections)).toBeNull();
  });
});

describe("what may be attached", () => {
  test("the kind decides the list, and nothing else appears on it", () => {
    expect(entriesFor("modbus", catalog, []).map((e) => e.entry.id)).toEqual(["modbus-device"]);
    expect(entriesFor("mqtt", catalog, []).map((e) => e.entry.id)).toEqual([
      "evcc-ingest",
      "ha-export",
    ]);
  });

  // The optimizer auto-provisions itself; the wizard lists nothing it cannot add.
  test("an entry that is not addable never reaches the wizard", () => {
    expect(entriesFor(null, catalog, [])).toEqual([]);
  });

  // #80's HA entity import is HTTP, not MQTT. A kind with no arm must answer
  // an empty list rather than throw — that is the whole point of the by-kind key.
  test("a kind the catalog has no arm for is empty, not an error", () => {
    expect(entriesFor("http" as never, catalog, [])).toEqual([]);
  });

  test("a single-instance entry is disabled once its connection already has one", () => {
    const taken = [{ kind: "ha-export", connectionId: 2 }];
    const rows = entriesFor("mqtt", catalog, taken, 2);
    expect(rows.find((r) => r.entry.id === "ha-export")?.taken).toBe(true);
    expect(rows.find((r) => r.entry.id === "evcc-ingest")?.taken).toBe(false);
  });

  test("the same integration on a DIFFERENT connection does not take this one", () => {
    const taken = [{ kind: "ha-export", connectionId: 7 }];
    expect(
      entriesFor("mqtt", catalog, taken, 2).find((r) => r.entry.id === "ha-export")?.taken,
    ).toBe(false);
  });

  test("a multi-instance entry is never taken, however many exist", () => {
    const taken = [
      { kind: "evcc-ingest", connectionId: 2 },
      { kind: "evcc-ingest", connectionId: 2 },
    ];
    expect(
      entriesFor("mqtt", catalog, taken, 2).find((r) => r.entry.id === "evcc-ingest")?.taken,
    ).toBe(false);
  });
});

describe("where the entry's settings come from", () => {
  // Seeding happens on the way INTO step 3, so it is asserted through the step
  // rather than against a helper nothing else calls.
  test("an entry with no fields opens step 3 with nothing to answer", () => {
    const state = advance(
      at({ step: "attach", connection: { mode: "existing", id: 1 }, entryId: "modbus-device" }),
      connections,
      catalog,
    );
    expect(state.values).toEqual({});
  });
});

describe("stepping", () => {
  test("the wizard refuses to leave step 1 without a connection", () => {
    expect(blockedAt(at(), connections, catalog)).toBe("connection");
    expect(advance(at(), connections, catalog).step).toBe("connection");
  });

  test("with a connection chosen, step 2 is reachable", () => {
    const state = at({ connection: { mode: "existing", id: 2 } });
    expect(blockedAt(state, connections, catalog)).toBeNull();
    expect(advance(state, connections, catalog).step).toBe("attach");
  });

  test("step 2 refuses to advance until an entry is picked", () => {
    const state = at({ step: "attach", connection: { mode: "existing", id: 2 } });
    expect(blockedAt(state, connections, catalog)).toBe("attach");
  });

  test("picking an entry seeds its settings, so step 3 opens filled in", () => {
    const state = advance(
      at({ step: "attach", connection: { mode: "existing", id: 2 }, entryId: "ha-export" }),
      connections,
      catalog,
    );
    expect(state.step).toBe("settings");
    expect(state.values).toEqual({ topicPrefix: "sunreye", haDiscoveryEnabled: false });
  });

  test("confirm is the last step and advancing again stays there", () => {
    const state = at({
      step: "confirm",
      connection: { mode: "existing", id: 2 },
      entryId: "evcc-ingest",
    });
    expect(advance(state, connections, catalog).step).toBe("confirm");
  });

  test("back walks the steps in reverse and stops at the first", () => {
    expect(goBack(at({ step: "confirm" })).step).toBe("settings");
    expect(goBack(at({ step: "attach" })).step).toBe("connection");
    expect(goBack(at({ step: "connection" })).step).toBe("connection");
  });

  // Changing the connection after picking an entry must not carry the entry
  // across: an EVCC ingest picked on a broker is meaningless on a gateway.
  test("going back and changing the connection clears the entry and its values", () => {
    const state = at({
      step: "settings",
      connection: { mode: "existing", id: 2 },
      entryId: "ha-export",
      values: { topicPrefix: "x" },
    });
    const moved = { ...goBack(goBack(state)), connection: { mode: "existing" as const, id: 1 } };
    const cleared = advance(moved, connections, catalog);
    expect(cleared.entryId).toBeNull();
    expect(cleared.values).toEqual({});
  });
});

describe("what the wizard finally sends", () => {
  // The TIER decides the endpoint: a profile-tier entry is a register map on an
  // address, so it is a DEVICE; a coded entry attached to a connection is an
  // INTEGRATION, which may yield devices later or none at all.
  test("a profile-tier entry is posted as a device", () => {
    const state = at({
      step: "confirm",
      connection: { mode: "existing", id: 1 },
      entryId: "modbus-device",
      values: { role: "meter", name: "Meter", unitId: 3, profileId: "acme.meter" },
    });
    expect(submissionOf(state, connections, catalog)).toEqual({
      target: "device",
      body: {
        via: "profile",
        connection: { id: 1 },
        role: "meter",
        name: "Meter",
        unitId: 3,
        profileId: "acme.meter",
      },
    });
  });

  test("a coded entry on a connection is posted as an integration", () => {
    const state = at({
      step: "confirm",
      connection: { mode: "existing", id: 2 },
      entryId: "ha-export",
      values: { topicPrefix: "sunreye" },
    });
    expect(submissionOf(state, connections, catalog)?.target).toBe("integration");
  });

  test("an integration submission carries its kind, its connection and its params", () => {
    const state = at({
      step: "confirm",
      connection: { mode: "existing", id: 2 },
      entryId: "evcc-ingest",
      values: { topicRoot: "evcc" },
    });
    expect(submissionOf(state, connections, catalog)).toEqual({
      target: "integration",
      body: { kind: "evcc-ingest", connectionId: 2, params: { topicRoot: "evcc" } },
    });
  });

  test("nothing is sent while the wizard is incomplete", () => {
    expect(submissionOf(at(), connections, catalog)).toBeNull();
    expect(
      submissionOf(at({ connection: { mode: "existing", id: 2 } }), connections, catalog),
    ).toBeNull();
  });

  // A connection still being created has no id, so the integration cannot be
  // addressed yet: the caller creates the connection first and re-asks.
  test("an unsaved connection yields no submission", () => {
    const state = at({
      step: "confirm",
      connection: { mode: "create", kind: "mqtt" },
      entryId: "evcc-ingest",
      values: {},
    });
    expect(submissionOf(state, connections, catalog)).toBeNull();
  });
});
