import { describe, expect, test } from "bun:test";

import { emptyForm } from "../devices/add-device-logic";
import {
  type AddDeviceForm,
  type ConnectionView,
  type DeviceView,
  NEW_CONNECTION,
} from "../devices/device-types";
import {
  type CatalogEntryView,
  type DeviceSeed,
  type WizardState,
  advance,
  blockedAt,
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
      // What `integration-catalog.ts` actually describes for the profile tier —
      // and what step 3 must NOT render as a catalog form: `arrays` is an array
      // and `battery` an object (the generic renderer can only report those),
      // `profileId` needs the picker, and there is no `name` at all, which is
      // the field `POST /api/devices` requires.
      fields: [
        { name: "role", type: "enum", required: true, options: ["inverter", "meter"] },
        { name: "profileId", type: "string", required: true },
        { name: "unitId", type: "number", required: true, min: 0, max: 247 },
        { name: "arrays", type: "array", required: false },
        { name: "battery", type: "object", required: false },
      ],
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

/**
 * The two endpoints as `/api/connections` returns them — full rows rather than
 * the picker's narrowing, because the device arm seeds its form off the roster.
 */
const connections: ConnectionView[] = [
  {
    id: 1,
    name: "Inverter",
    kind: "modbus",
    params: {
      host: "10.0.0.5",
      port: 502,
      transport: "tcp",
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    },
  },
  {
    id: 2,
    name: "Broker",
    kind: "mqtt",
    params: { brokerUrl: "mqtt://b:1883", hasPassword: false },
  },
];

/** An in-service device holding one unit id on the gateway. */
const onBus = (unitId: number): DeviceView =>
  ({ id: unitId + 1, unitId, connectionId: 1, retiredAt: null }) as DeviceView;

const seed = (devices: DeviceView[] = []): DeviceSeed => ({ connections, devices });

/** A device form the add body accepts, so a case can spoil one field at a time. */
const deviceForm = (over: Partial<AddDeviceForm> = {}): AddDeviceForm => ({
  ...emptyForm(connections, [], "1"),
  role: "meter",
  unitId: 3,
  name: "Cellar meter",
  profileId: "acme.meter",
  ...over,
});

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
  test("a coded entry with no fields opens step 3 with nothing to answer", () => {
    const bare = {
      ...catalog,
      mqtt: [{ ...catalog.mqtt[1], id: "bare", fields: [] }],
    } as typeof catalog;
    const state = advance(
      at({ step: "attach", connection: { mode: "existing", id: 2 }, entryId: "bare" }),
      connections,
      bare,
    );
    expect(state.answers).toEqual({ via: "coded", values: {} });
  });

  /**
   * THE BUG THIS FILE WAS WRITTEN FOR.
   *
   * The profile tier is a DEVICE, and a device is not two or three scalars: it
   * is the add dialog's own form. Rendered as a catalog form, step 3 printed
   * "arrays: array" and "battery: object", offered a free-text box where the
   * profile picker belongs, and asked for no NAME at all — which
   * `POST /api/devices` requires, so the whole Modbus arm could not succeed.
   */
  test("a profile-tier entry opens step 3 on a DEVICE form, not on catalog values", () => {
    const state = advance(
      at({ step: "attach", connection: { mode: "existing", id: 1 }, entryId: "modbus-device" }),
      connections,
      catalog,
      true,
      seed(),
    );
    expect(state.answers.via).toBe("profile");
    if (state.answers.via !== "profile") throw new Error("unreachable");
    // Addressed at the endpoint step 1 already answered, so the operator is
    // never asked the same question twice — and so the taken-unit-id set is
    // this gateway's.
    expect(state.answers.form.connectionChoice).toBe("1");
    expect(state.answers.form.name).toBe("");
    expect(state.answers.form.role).toBe("inverter");
  });

  test("the seeded unit id is the lowest free one ON THAT gateway", () => {
    const state = advance(
      at({ step: "attach", connection: { mode: "existing", id: 1 }, entryId: "modbus-device" }),
      connections,
      catalog,
      true,
      seed([onBus(0), onBus(1)]),
    );
    if (state.answers.via !== "profile") throw new Error("expected the device arm");
    expect(state.answers.form.unitId).toBe(2);
  });

  // The endpoint does not exist yet, so nothing is addressed on it and every
  // unit id is free — the same answer `takenUnitIds` gives the dialog.
  test("a connection still being created seeds the form on the create arm", () => {
    const state = advance(
      at({
        step: "attach",
        connection: { mode: "create", kind: "modbus" },
        entryId: "modbus-device",
      }),
      connections,
      catalog,
      true,
      seed([onBus(0)]),
    );
    if (state.answers.via !== "profile") throw new Error("expected the device arm");
    expect(state.answers.form.connectionChoice).toBe(NEW_CONNECTION);
    expect(state.answers.form.unitId).toBe(0);
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
    expect(state.answers).toEqual({
      via: "coded",
      values: { topicPrefix: "sunreye", haDiscoveryEnabled: false },
    });
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
      answers: { via: "coded" as const, values: { topicPrefix: "x" } },
    });
    const moved = { ...goBack(goBack(state)), connection: { mode: "existing" as const, id: 1 } };
    const cleared = advance(moved, connections, catalog);
    expect(cleared.entryId).toBeNull();
    expect(cleared.answers).toEqual({ via: "coded", values: {} });
  });
});

/**
 * STEP 3'S GATE, ON THE DEVICE ARM.
 *
 * The coded arm keeps its old rule — the server validates an integration's
 * params and refuses with the field named. A device cannot: `Next` there leads
 * straight to the confirm screen and then to a 400 the operator cannot act on,
 * so the form's own answer to "could this be submitted" holds the step.
 */
describe("step 3 on the device arm", () => {
  const onSettings = (form: AddDeviceForm): WizardState =>
    at({
      step: "settings",
      connection: { mode: "existing", id: 1 },
      entryId: "modbus-device",
      answers: { via: "profile", form },
    });

  test("a complete device form lets the wizard through to confirm", () => {
    const state = onSettings(deviceForm());
    expect(blockedAt(state, connections, catalog)).toBeNull();
    expect(advance(state, connections, catalog, true, seed()).step).toBe("confirm");
  });

  test("the freshly seeded form holds the step — it has no name and no profile", () => {
    const state = onSettings(emptyForm(connections, [], "1"));
    expect(blockedAt(state, connections, catalog)).toBe("settings");
    expect(advance(state, connections, catalog, true, seed()).step).toBe("settings");
  });

  test.each([
    ["an empty name", { name: "" }],
    ["a name of nothing but spaces", { name: "   " }],
    // `slugify` keeps nothing from these, so the row would get a slug the
    // operator never chose — the server's own `nameSchema` refuses them too.
    ["a name that slugifies to nothing", { name: "###" }],
    ["no profile", { profileId: "" }],
    ["unit id 248, one past the reserved boundary", { unitId: 248 }],
    ["unit id -1", { unitId: -1 }],
    ["a fractional unit id", { unitId: 1.5 }],
  ])("%s holds step 3", (_why, over) => {
    expect(blockedAt(onSettings(deviceForm(over)), connections, catalog)).toBe("settings");
  });

  // The two ends that ARE addressable: a gateway answers on 0, and 247 is the
  // last slave id before the reserved range.
  test.each([0, 247])("unit id %i is addressable and passes", (unitId) => {
    expect(blockedAt(onSettings(deviceForm({ unitId })), connections, catalog)).toBeNull();
  });

  /**
   * A unit id already taken on this gateway is NOT held here.
   *
   * The picker disables the ids it knows about and the database index is the
   * authority (409 on a stale list). Blocking on the roster the page happens to
   * hold would refuse a legitimate add whenever a device was retired in another
   * tab, with nothing on screen to explain it.
   */
  test("a duplicate unit id is left to the server's index, not held by the gate", () => {
    const state = onSettings(deviceForm({ unitId: 0 }));
    expect(blockedAt(state, connections, catalog)).toBeNull();
    expect(submissionOf(state, connections, catalog)).not.toBeNull();
  });

  // The coded arm's params are the server's to validate; step 3 never held it
  // and must not start.
  test("a coded entry's settings step is never held", () => {
    const state = at({
      step: "settings",
      connection: { mode: "existing", id: 2 },
      entryId: "ha-export",
      answers: { via: "coded", values: {} },
    });
    expect(blockedAt(state, connections, catalog)).toBeNull();
  });
});

describe("what the wizard finally sends", () => {
  // The TIER decides the endpoint: a profile-tier entry is a register map on an
  // address, so it is a DEVICE; a coded entry attached to a connection is an
  // INTEGRATION, which may yield devices later or none at all.
  const onConfirm = (form: AddDeviceForm, id = 1): WizardState =>
    at({
      step: "confirm",
      connection: { mode: "existing", id },
      entryId: "modbus-device",
      answers: { via: "profile", form },
    });

  // Exactly the body `POST /api/devices` accepts, built through the dialog's own
  // `buildAddDeviceBody` — so the unit-id rule, the trim and the per-role
  // inverter fields cannot drift between the two surfaces.
  test("a profile-tier entry is posted as the device body the route accepts", () => {
    expect(submissionOf(onConfirm(deviceForm()), connections, catalog)).toEqual({
      target: "device",
      body: {
        via: "profile",
        connection: { id: 1 },
        role: "meter",
        name: "Cellar meter",
        unitId: 3,
        profileId: "acme.meter",
      },
    });
  });

  // A meter carries no roof and no pack, and the server refuses those fields on
  // any role but `inverter` — so the body must not carry them.
  test("an inverter's body carries its arrays and its pack; a meter's carries neither", () => {
    const inverter = deviceForm({
      role: "inverter",
      name: "Cellar inverter",
      inverter: {
        ...deviceForm().inverter,
        arrays: [{ kwp: "8.4", tilt: "35", azimuth: "0" }],
      },
    });
    const submission = submissionOf(onConfirm(inverter), connections, catalog);
    expect(submission?.body).toMatchObject({
      role: "inverter",
      arrays: [{ kwp: 8.4, tilt: 35, azimuth: 0 }],
    });
    expect(submissionOf(onConfirm(deviceForm()), connections, catalog)?.body).not.toHaveProperty(
      "arrays",
    );
  });

  test("the name is trimmed on the way out, exactly as the dialog trims it", () => {
    const submission = submissionOf(
      onConfirm(deviceForm({ name: "  Cellar meter  " })),
      connections,
      catalog,
    );
    expect(submission?.body).toMatchObject({ name: "Cellar meter" });
  });

  test.each([
    ["an empty name", { name: "" }],
    ["a name that slugifies to nothing", { name: "###" }],
    ["no profile", { profileId: "" }],
    ["unit id 248", { unitId: 248 }],
    ["unit id -1", { unitId: -1 }],
  ])("%s sends nothing at all", (_why, over) => {
    expect(submissionOf(onConfirm(deviceForm(over)), connections, catalog)).toBeNull();
  });

  // The form's own `connectionChoice` is step 1's answer, not a second question:
  // whatever it was seeded with, the body is addressed at the chosen row.
  test("the body is addressed at the wizard's connection, not the form's", () => {
    const strayed = deviceForm({ connectionChoice: NEW_CONNECTION });
    expect(submissionOf(onConfirm(strayed, 1), connections, catalog)?.body).toMatchObject({
      connection: { id: 1 },
    });
  });

  // A profile entry whose step 3 never ran has no form to send.
  test("a profile-tier entry with coded answers sends nothing", () => {
    const state = at({
      step: "confirm",
      connection: { mode: "existing", id: 1 },
      entryId: "modbus-device",
      answers: { via: "coded", values: {} },
    });
    expect(submissionOf(state, connections, catalog)).toBeNull();
  });

  test("a coded entry on a connection is posted as an integration", () => {
    const state = at({
      step: "confirm",
      connection: { mode: "existing", id: 2 },
      entryId: "ha-export",
      answers: { via: "coded", values: { topicPrefix: "sunreye" } },
    });
    expect(submissionOf(state, connections, catalog)?.target).toBe("integration");
  });

  test("an integration submission carries its kind, its connection and its params", () => {
    const state = at({
      step: "confirm",
      connection: { mode: "existing", id: 2 },
      entryId: "evcc-ingest",
      answers: { via: "coded", values: { topicRoot: "evcc" } },
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
      answers: { via: "coded", values: {} },
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
      answers: { via: "coded" as const, values: { topicPrefix: "x" } },
    });
    const switched = {
      ...goBack(goBack(state)),
      connection: { mode: "create" as const, kind: "modbus" as const },
    };
    const cleared = advance(switched, connections, catalog);
    expect(cleared.entryId).toBeNull();
    expect(cleared.answers).toEqual({ via: "coded", values: {} });
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
    answers: { via: "coded" as const, values: { topicRoot: "evcc" } },
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
      answers: { via: "coded", values: { topicRoot: "evcc" } },
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
    expect(next.answers).toEqual({ via: "coded", values: { topicRoot: "evcc" } });
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

  /**
   * The DEVICE arm over a connection the wizard is creating.
   *
   * Same two requests in the same order — and the device body must end up
   * addressed at the gateway that came back, never at the {@link NEW_CONNECTION}
   * sentinel its form was seeded with (which would ask `POST /api/devices` to
   * create a SECOND endpoint out of the form's blank draft).
   */
  describe("a device on a gateway that does not exist yet", () => {
    const drafted = at({
      step: "confirm",
      connection: { mode: "create", kind: "modbus" },
      entryId: "modbus-device",
      answers: { via: "profile", form: deviceForm({ connectionChoice: NEW_CONNECTION }) },
    });

    test("the gateway is created first", () => {
      expect(submitPlan(drafted, connections, catalog)).toEqual({
        do: "create-connection",
        kind: "modbus",
      });
    });

    test("then the device is posted against the id it answered", () => {
      const next = withSavedConnection(drafted, 9);
      const withRow: ConnectionView[] = [
        ...connections,
        {
          id: 9,
          name: "New gateway",
          kind: "modbus",
          params: {
            host: "10.0.0.9",
            port: 502,
            transport: "tcp",
            timeoutMs: 2000,
            pollIntervalMs: 1000,
          },
        },
      ];
      expect(submitPlan(next, withRow, catalog)).toEqual({
        do: "send",
        submission: {
          target: "device",
          body: {
            via: "profile",
            connection: { id: 9 },
            role: "meter",
            name: "Cellar meter",
            unitId: 3,
            profileId: "acme.meter",
          },
        },
      });
    });
  });
});
