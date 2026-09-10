import { describe, expect, test } from "bun:test";

import { NEW_CONNECTION } from "../devices/device-types";
import {
  type CatalogEntryView,
  type WizardState,
  advance,
  blockedAt,
  catalogEntryFor,
  connectionChoice,
  emptyWizard,
  entriesFor,
  goBack,
  submissionOf,
  submitPlan,
  wizardKind,
  withSavedConnection,
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

describe("step 1's answer", () => {
  test("an option naming a row is that row", () => {
    expect(connectionChoice("2", "modbus")).toEqual({ mode: "existing", id: 2 });
  });

  // The placeholder is not an answer, and neither is a value that is not a
  // positive id — `Number("")` is 0 and `Number("x")` is NaN.
  test("the placeholder, and anything that is not an id, answer nothing", () => {
    expect(connectionChoice("", "modbus")).toBeNull();
    expect(connectionChoice("x", "modbus")).toBeNull();
    expect(connectionChoice("0", "modbus")).toBeNull();
  });

  // The one option that is not a row: the endpoint does not exist yet, and the
  // kind it is being created as is what step 2 is keyed by.
  test("the create option answers the create arm, on the kind the form shows", () => {
    expect(connectionChoice(NEW_CONNECTION, "mqtt")).toEqual({ mode: "create", kind: "mqtt" });
  });
});

describe("a connection that does not exist yet", () => {
  // The whole point of the create arm carrying its kind: step 2 is the catalog
  // for that kind, with no row saved and no id to key anything by.
  test("the create arm reaches step 2 on its kind's catalog", () => {
    const state = at({ connection: { mode: "create", kind: "mqtt" } });
    const moved = advance(state, connections, catalog);
    expect(moved.step).toBe("attach");
    expect(entriesFor(wizardKind(moved, connections), catalog, []).map((o) => o.entry.id)).toEqual([
      "evcc-ingest",
      "ha-export",
    ]);
  });

  // An entry picked on a broker means nothing on a gateway, saved row or not.
  test("going back and switching the kind clears the entry and its values", () => {
    const state = at({
      step: "settings",
      connection: { mode: "create", kind: "mqtt" },
      entryId: "ha-export",
      values: { topicPrefix: "x" },
    });
    const switched = {
      ...goBack(goBack(state)),
      connection: { mode: "create" as const, kind: "modbus" as const },
    };
    const cleared = advance(switched, connections, catalog);
    expect(cleared.entryId).toBeNull();
    expect(cleared.values).toEqual({});
  });

  // The draft's completeness is the FORM's answer, handed in as a boolean so
  // these rules never learn what a broker URL is.
  test("step 1 holds while the new connection could not be saved", () => {
    const state = at({ connection: { mode: "create", kind: "mqtt" } });
    expect(blockedAt(state, connections, catalog, false)).toBe("connection");
    expect(advance(state, connections, catalog, false).step).toBe("connection");
    expect(blockedAt(state, connections, catalog, true)).toBeNull();
  });

  test("a chosen row is never held by the new-connection form's state", () => {
    const state = at({ connection: { mode: "existing", id: 2 } });
    expect(blockedAt(state, connections, catalog, false)).toBeNull();
  });
});

describe("the order the finish button works in", () => {
  const created = at({
    step: "confirm",
    connection: { mode: "create", kind: "mqtt" },
    entryId: "evcc-ingest",
    values: { topicRoot: "evcc" },
  });

  // The endpoint is created at FINISH and not when step 1 was left: a wizard
  // abandoned at step 3 must leave no orphan connection row behind.
  test("an unsaved connection is created before anything is attached to it", () => {
    expect(submitPlan(created, connections, catalog)).toEqual({
      do: "create-connection",
      kind: "mqtt",
    });
  });

  test("a saved connection is sent straight out", () => {
    const state = at({
      step: "confirm",
      connection: { mode: "existing", id: 2 },
      entryId: "evcc-ingest",
      values: { topicRoot: "evcc" },
    });
    expect(submitPlan(state, connections, catalog)).toEqual({
      do: "send",
      submission: {
        target: "integration",
        body: { kind: "evcc-ingest", connectionId: 2, params: { topicRoot: "evcc" } },
      },
    });
  });

  test("an incomplete wizard plans nothing at all", () => {
    expect(submitPlan(at(), connections, catalog)).toEqual({ do: "nothing" });
  });

  // The row exists now — on a retry after a failed attach, and on the ordinary
  // path. Either way the wizard must point at it rather than create a second.
  test("the saved row's id turns the create arm into that row", () => {
    const next = withSavedConnection(created, 9);
    expect(next.connection).toEqual({ mode: "existing", id: 9 });
    expect(next.entryId).toBe("evcc-ingest");
    expect(next.values).toEqual({ topicRoot: "evcc" });
    expect(next.step).toBe("confirm");
  });

  test("and the plan that follows it sends against that id", () => {
    const next = withSavedConnection(created, 9);
    const withRow = [...connections, { id: 9, name: "New broker", kind: "mqtt" as const }];
    expect(submitPlan(next, withRow, catalog)).toEqual({
      do: "send",
      submission: {
        target: "integration",
        body: { kind: "evcc-ingest", connectionId: 9, params: { topicRoot: "evcc" } },
      },
    });
  });
});

/**
 * The entry a CONFIGURED row belongs to.
 *
 * `entriesFor` answers "what may be attached HERE" and filters to the addable
 * ones on one connection kind. This is the other direction: a row already
 * exists, its kind is stored, and the form editing it has to find the entry
 * whose fields the server will validate the write against. Searching all three
 * arms is the point — a row's own connection kind is not in the question, and a
 * form that looked in only one would refuse to edit a connection-less entry.
 *
 * Both editors call it (the row dialog on the devices page, the integration's
 * own page), which is why it is one function: two copies would be free to
 * disagree about what "this build has no entry for that" looks like.
 */
describe("catalogEntryFor", () => {
  test("finds an entry whichever arm of the catalog it lives on", () => {
    expect(catalogEntryFor(catalog, "modbus-device")?.label).toBe("Modbus device");
    expect(catalogEntryFor(catalog, "evcc-ingest")?.label).toBe("EVCC");
    expect(catalogEntryFor(catalog, "sunreye.optimizer")?.label).toBe("SunReye Optimizer");
  });

  // A database migrated ahead of the binary. The server refuses to validate
  // such a row's settings too (409), so the editor has to be able to say there
  // is nothing to edit rather than render a form no write can land.
  test("a kind this build has no entry for is null, not a throw", () => {
    expect(catalogEntryFor(catalog, "from-the-future")).toBeNull();
  });

  // The caller reads the kind off a row that may not have arrived yet.
  test("no kind at all is null", () => {
    expect(catalogEntryFor(catalog, undefined)).toBeNull();
  });

  test("an empty catalog — the state before the fetch answers — is null", () => {
    expect(catalogEntryFor({ modbus: [], mqtt: [], internal: [] }, "evcc-ingest")).toBeNull();
  });
});
