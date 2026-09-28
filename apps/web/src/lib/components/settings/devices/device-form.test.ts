import { describe, expect, test } from "bun:test";

import {
  buildAddDeviceBody,
  connectionOptions,
  devicePatch,
  emptyForm,
  formFromDevice,
  nameProblem,
  profileGroups,
  renameBlock,
  takenUnitIds,
  type RenameState,
} from "./device-form";
import { NEW_CONNECTION } from "./device-types";
import type { ConnectionView, DeviceView } from "./device-types";

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

describe("connectionOptions", () => {
  test("labels each connection by name and address, values are the id as a string", () => {
    expect(
      connectionOptions([
        gateway,
        {
          ...gateway,
          id: 4,
          name: "Keller",
          params: { ...gateway.params, host: "10.0.0.9", port: 8899 },
        },
      ]),
    ).toEqual([
      { value: "3", label: "Gateway 1 · 10.0.0.5:502" },
      { value: "4", label: "Keller · 10.0.0.9:8899" },
    ]);
  });

  test("a blank host reads as the name alone — an addressless row is a real state", () => {
    expect(connectionOptions([{ ...gateway, params: { ...gateway.params, host: "" } }])).toEqual([
      { value: "3", label: "Gateway 1" },
    ]);
  });

  // A device in this dialog is a Modbus slave: it has a unit id and a register
  // profile. A broker carries neither, and the mapped devices that will sit on
  // one are #79–#84 — so offering it here would offer an address that cannot be
  // written (#217).
  test("a broker is not offered — this dialog addresses a Modbus slave", () => {
    expect(connectionOptions([brokerConn, gateway]).map((o) => o.value)).toEqual(["3"]);
    expect(connectionOptions([brokerConn])).toEqual([]);
  });
});

describe("the default connection name", () => {
  test("numbers past the connections that exist", () => {
    expect(emptyForm([]).newConnection.name).toBe("Gateway 1");
    expect(emptyForm([gateway, gateway]).newConnection.name).toBe("Gateway 3");
    // A broker counts as a connection for the numbering — the name is a label
    // on the plant's endpoints, not on its Modbus buses.
    expect(emptyForm([brokerConn]).newConnection.name).toBe("Gateway 2");
  });
});

describe("takenUnitIds", () => {
  const devices = [
    device({ unitId: 0 }),
    device({ id: 2, slug: "meter", unitId: 2 }),
    device({
      id: 3,
      slug: "old",
      unitId: 5,
      retiredAt: "2026-01-01T00:00:00Z",
    }),
    device({ id: 4, slug: "other-gw", unitId: 1, connectionId: 4 }),
  ];

  test("collects the in-service unit ids of THAT connection only — 0 included", () => {
    expect([...takenUnitIds(devices, "3")].sort()).toEqual([0, 2]);
  });

  test("a retired device does not hold its unit id — the server's index ignores it too", () => {
    expect(takenUnitIds(devices, "3").has(5)).toBe(false);
  });

  test("the same unit id on another connection stays free here", () => {
    expect(takenUnitIds(devices, "4").has(2)).toBe(false);
    expect(takenUnitIds(devices, "4").has(1)).toBe(true);
  });

  test("a new connection has no devices yet, so nothing is taken", () => {
    expect(takenUnitIds(devices, NEW_CONNECTION).size).toBe(0);
  });

  test("the form defaults to the lowest free id, and 0 counts as an id", () => {
    expect(emptyForm([gateway], []).unitId).toBe(0);
    expect(
      emptyForm([gateway], [device({ unitId: 0 }), device({ id: 2, slug: "m", unitId: 1 })]).unitId,
    ).toBe(2);
    expect(emptyForm([gateway], [device({ unitId: 1 })]).unitId).toBe(0);
  });
});

describe("nameProblem", () => {
  test("a name that slugs to something and fits is fine, and the slug is previewed", () => {
    expect(nameProblem("Zähler Süd")).toBeNull();
  });

  test.each([
    ["", "empty"],
    ["   ", "blank"],
    ["!!!", "no letter or digit"],
    ["x".repeat(49), "over the slug ceiling"],
  ])("%j is refused (%s)", (name) => {
    expect(nameProblem(name)).not.toBeNull();
  });
});

describe("profileGroups", () => {
  test("groups by manufacturer, both levels sorted, and labels a version or built-in", () => {
    const groups = profileGroups(
      [
        {
          id: "b",
          name: "Beta",
          manufacturer: "Zeta",
          active: false,
          installed: true,
          builtin: false,
          version: "1.2.0",
        },
        {
          id: "a",
          name: "Alpha",
          manufacturer: "Acme",
          active: true,
          installed: false,
          builtin: true,
        },
        {
          id: "c",
          name: "Aardvark",
          manufacturer: "Zeta",
          active: false,
          installed: true,
          builtin: false,
          version: "0.1.0",
        },
      ],
      "Built in",
    );
    expect(groups.map((g) => g.manufacturer)).toEqual(["Acme", "Zeta"]);
    expect(groups[1]?.options.map((o) => o.label)).toEqual(["Aardvark · v0.1.0", "Beta · v1.2.0"]);
    expect(groups[0]?.options[0]).toEqual({
      value: "a",
      label: "Alpha · Built in",
    });
  });

  test("a profile with no manufacturer lands under Other", () => {
    expect(
      profileGroups(
        [
          {
            id: "x",
            name: "X",
            manufacturer: "",
            active: false,
            installed: true,
            builtin: false,
          },
        ],
        "b",
      )[0]?.manufacturer,
    ).toBe("Other");
  });
});

describe("buildAddDeviceBody", () => {
  const filled = () => ({
    ...emptyForm([gateway]),
    connectionChoice: "3",
    role: "meter" as const,
    unitId: 2,
    name: " Zähler Süd ",
    profileId: "sdm630",
  });

  test("an existing connection becomes { id }, the name is trimmed", () => {
    expect(buildAddDeviceBody(filled())).toEqual({
      connection: { id: 3 },
      role: "meter",
      unitId: 2,
      name: "Zähler Süd",
      profileId: "sdm630",
    });
  });

  test("the new-connection choice becomes { create } with the typed endpoint", () => {
    const form = filled();
    form.connectionChoice = NEW_CONNECTION;
    form.newConnection = {
      ...form.newConnection,
      modbus: { ...form.newConnection.modbus, host: " 10.0.0.9 ", port: 8899 },
    };
    const body = buildAddDeviceBody(form);
    // A device dialog only ever makes a Modbus endpoint; a broker is added on
    // its own, from the panel that lists the connections.
    expect(body?.connection).toEqual({
      create: {
        name: "Gateway 2",
        kind: "modbus",
        params: {
          host: "10.0.0.9",
          port: 8899,
          transport: "tcp",
          timeoutMs: 2000,
          pollIntervalMs: 1000,
        },
      },
    });
  });

  test.each([
    ["no profile", { profileId: "" }],
    ["a bad name", { name: "!!!" }],
    ["unit id -1", { unitId: -1 }],
    ["unit id 248", { unitId: 248 }],
    ["a fractional unit id", { unitId: 1.5 }],
    [
      "a new connection with no host",
      {
        connectionChoice: NEW_CONNECTION,
        newConnection: {
          ...emptyForm([]).newConnection,
          modbus: { ...emptyForm([]).newConnection.modbus, host: " " },
        },
      },
    ],
    ["a connection choice that is not a number", { connectionChoice: "abc" }],
  ])("is null for %s — the submit button stays disabled", (_label, over) => {
    expect(buildAddDeviceBody({ ...filled(), ...over })).toBeNull();
  });

  test("the empty form defaults to the first connection, its first free unit id and the inverter role", () => {
    const form = emptyForm(
      [gateway],
      [device({ unitId: 0 }), device({ id: 2, slug: "m", unitId: 1 })],
    );
    expect(form.connectionChoice).toBe("3");
    expect(form.unitId).toBe(2);
    expect(form.role).toBe("inverter");
    expect(form.newConnection.modbus.port).toBe(502);
    expect(form.newConnection.name).toBe("Gateway 2");
  });

  test("with no connections at all the empty form starts on 'new'", () => {
    expect(emptyForm([]).connectionChoice).toBe(NEW_CONNECTION);
  });
});

describe("editing a device", () => {
  const meter = device({
    id: 2,
    slug: "meter",
    name: "Meter",
    role: "meter",
    unitId: 2,
    profileId: "sdm630",
  });

  test("the form starts from the device's own values, with no new-connection arm", () => {
    const form = formFromDevice(meter, [gateway]);
    expect(form.connectionChoice).toBe("3");
    expect(form.role).toBe("meter");
    expect(form.unitId).toBe(2);
    expect(form.name).toBe("Meter");
    expect(form.profileId).toBe("sdm630");
  });

  test("an endpoint-less device starts on the first gateway so it can be bound", () => {
    expect(
      formFromDevice({ ...meter, connectionId: null, connection: null }, [gateway])
        .connectionChoice,
    ).toBe("3");
  });

  test("the patch carries ONLY what changed, and nothing when nothing did", () => {
    const form = formFromDevice(meter, [gateway]);
    expect(devicePatch(meter, form)).toBeNull();
    form.unitId = 5;
    form.name = " Meter ";
    expect(devicePatch(meter, form)).toEqual({ unitId: 5 });
    form.connectionChoice = "4";
    form.profileId = "deye";
    form.role = "charger";
    form.name = "Zähler";
    expect(devicePatch(meter, form)).toEqual({
      unitId: 5,
      connectionId: 4,
      profileId: "deye",
      role: "charger",
      name: "Zähler",
    });
  });

  test("an invalid edit is null — a blank name, a bad unit id, the new-connection choice", () => {
    const form = formFromDevice(meter, [gateway]);
    expect(devicePatch(meter, { ...form, name: "!!!" })).toBeNull();
    expect(devicePatch(meter, { ...form, unitId: 300 })).toBeNull();
    expect(devicePatch(meter, { ...form, connectionChoice: NEW_CONNECTION })).toBeNull();
  });
});

describe("the inverter section of the form", () => {
  const filledInverter = () => ({
    ...emptyForm([gateway]),
    connectionChoice: "3",
    role: "inverter" as const,
    unitId: 2,
    name: "East",
    profileId: "deye",
    inverter: {
      arrays: [{ kwp: "3.2", tilt: "20", azimuth: "-90" }],
      tempCoeff: "-0.3",
      loss: "20",
      battUsable: "10",
      battCharge: "5",
      battReserve: "",
      battNominalV: "",
    },
  });

  test("a new inverter opens on the column defaults and no arrays", () => {
    const form = emptyForm([gateway]);
    expect(form.inverter).toEqual({
      arrays: [],
      tempCoeff: "-0.4",
      loss: "14",
      battUsable: "",
      battCharge: "",
      battReserve: "",
      battNominalV: "",
    });
  });

  test("an inverter's body carries its roof and pack, parsed", () => {
    expect(buildAddDeviceBody(filledInverter())).toMatchObject({
      role: "inverter",
      arrays: [{ kwp: 3.2, tilt: 20, azimuth: -90 }],
      tempCoefficient: -0.3,
      systemLoss: 20,
      battery: { usableKwh: 10, maxChargeW: 5000, minSoc: 10, nominalV: null },
    });
  });

  test("a meter's body carries NONE of them — the server would refuse", () => {
    const body = buildAddDeviceBody({ ...filledInverter(), role: "meter" });
    expect(body).not.toBeNull();
    expect(Object.keys(body ?? {}).sort()).toEqual([
      "connection",
      "name",
      "profileId",
      "role",
      "unitId",
    ]);
  });

  test("an unreadable roof field blocks the submit, on an inverter only", () => {
    const form = filledInverter();
    form.inverter.loss = "lots";
    expect(buildAddDeviceBody(form)).toBeNull();
    expect(buildAddDeviceBody({ ...form, role: "meter" })).not.toBeNull();
  });

  test("editing starts from the device's own roof and pack", () => {
    const inv = device({
      arrays: [{ kwp: 9.8, tilt: 30, azimuth: 0 }],
      systemLoss: 11,
      battery: { usableKwh: 15, maxChargeW: null, minSoc: 10, nominalV: 48 },
    });
    const form = formFromDevice(inv, [gateway]);
    expect(form.inverter.arrays).toEqual([{ kwp: "9.8", tilt: "30", azimuth: "0" }]);
    expect(form.inverter.loss).toBe("11");
    expect(form.inverter.battUsable).toBe("15");
    expect(form.inverter.battNominalV).toBe("48");
    // Nothing changed → nothing to send.
    expect(devicePatch(inv, form)).toBeNull();
  });

  test("the patch carries only the roof or pack field that changed, compared by value", () => {
    const inv = device({
      arrays: [{ kwp: 9.8, tilt: 30, azimuth: 0 }],
      battery: { usableKwh: 15, maxChargeW: null, minSoc: 10, nominalV: null },
    });
    const form = formFromDevice(inv, [gateway]);
    form.inverter.arrays[0]!.tilt = "35";
    expect(devicePatch(inv, form)).toEqual({
      arrays: [{ kwp: 9.8, tilt: 35, azimuth: 0 }],
    });
    const cleared = formFromDevice(inv, [gateway]);
    cleared.inverter.battUsable = "";
    expect(devicePatch(inv, cleared)).toEqual({ battery: null });
    const physics = formFromDevice(inv, [gateway]);
    physics.inverter.loss = "9";
    expect(devicePatch(inv, physics)).toEqual({ systemLoss: 9 });
  });
});

const state = (over: Partial<RenameState> = {}): RenameState => ({
  typed: "Carport West",
  current: "Carport",
  submitting: false,
  ...over,
});

describe("whether a rename may be submitted", () => {
  test("a changed, valid name is submittable", () => {
    expect(renameBlock(state())).toBeNull();
  });

  test("no row open blocks before anything else is judged", () => {
    expect(renameBlock(state({ current: null, typed: "" }))).toBe("no-row");
  });

  test("a request in flight blocks a second one", () => {
    expect(renameBlock(state({ submitting: true }))).toBe("submitting");
  });

  test("empty, and whitespace-only, are the same emptiness", () => {
    expect(renameBlock(state({ typed: "" }))).toBe("empty");
    expect(renameBlock(state({ typed: "   " }))).toBe("empty");
  });

  test("a name with no letter or digit is refused before the request", () => {
    expect(renameBlock(state({ typed: "---" }))).toBe("invalid");
    expect(renameBlock(state({ typed: "x".repeat(200) }))).toBe("invalid");
  });

  // Not an error — a no-op. The server answers `nothing to change` with a 400,
  // and an operator who reopened the dialog and closed it should see neither.
  test("the row's own name is a no-op, and the trim decides that", () => {
    expect(renameBlock(state({ typed: "Carport" }))).toBe("unchanged");
    expect(renameBlock(state({ typed: "  Carport  " }))).toBe("unchanged");
    expect(renameBlock(state({ typed: "carport" }))).toBeNull();
  });
});
