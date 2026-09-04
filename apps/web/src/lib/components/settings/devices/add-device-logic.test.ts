import { describe, expect, test } from "bun:test";

import {
  buildAddDeviceBody,
  connectionCaption,
  connectionOptions,
  describeProbe,
  describeRefusal,
  devicePatch,
  formFromDevice,
  groupByConnection,
  emptyForm,
  nameProblem,
  profileGroups,
  takenUnitIds,
} from "./add-device-logic";
import { NEW_CONNECTION } from "./device-types";
import type { ConnectionView, DeviceView } from "./device-types";

const gateway: ConnectionView = {
  id: 3,
  name: "Gateway 1",
  host: "10.0.0.5",
  port: 502,
  transport: "tcp",
  timeoutMs: 2000,
  pollIntervalMs: 1000,
};

const device = (over: Partial<DeviceView>): DeviceView => ({
  id: 1,
  slug: "inverter",
  name: "Inverter",
  profileId: "deye",
  role: "inverter",
  unitId: 1,
  connectionId: 3,
  retiredAt: null,
  connection: gateway,
  arrays: [],
  tempCoefficient: -0.4,
  systemLoss: 14,
  battery: null,
  profileName: "Deye",
  profileKnown: true,
  polled: true,
  ...over,
});

describe("connectionOptions", () => {
  test("labels each connection by name and address, values are the id as a string", () => {
    expect(
      connectionOptions([
        gateway,
        { ...gateway, id: 4, name: "Keller", host: "10.0.0.9", port: 8899 },
      ]),
    ).toEqual([
      { value: "3", label: "Gateway 1 · 10.0.0.5:502" },
      { value: "4", label: "Keller · 10.0.0.9:8899" },
    ]);
  });

  test("a blank host reads as the name alone — an addressless row is a real state", () => {
    expect(connectionOptions([{ ...gateway, host: "" }])).toEqual([
      { value: "3", label: "Gateway 1" },
    ]);
  });
});

describe("the default connection name", () => {
  test("numbers past the connections that exist", () => {
    expect(emptyForm([]).newConnection.name).toBe("Gateway 1");
    expect(emptyForm([gateway, gateway]).newConnection.name).toBe("Gateway 3");
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
      host: " 10.0.0.9 ",
      port: 8899,
    };
    const body = buildAddDeviceBody(form);
    expect(body?.connection).toEqual({
      create: {
        name: "Gateway 2",
        host: "10.0.0.9",
        port: 8899,
        transport: "tcp",
        timeoutMs: 2000,
        pollIntervalMs: 1000,
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
        newConnection: { ...emptyForm([]).newConnection, host: " " },
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
    expect(form.newConnection.port).toBe(502);
    expect(form.newConnection.name).toBe("Gateway 2");
  });

  test("with no connections at all the empty form starts on 'new'", () => {
    expect(emptyForm([]).connectionChoice).toBe(NEW_CONNECTION);
  });
});

describe("describeRefusal", () => {
  test("carries the server's reason under the field it named", () => {
    expect(describeRefusal({ error: "unit id: taken", field: "unitId" }, "?")).toEqual({
      field: "unitId",
      message: "unit id: taken",
    });
  });

  test("only the fields the dialog has are honoured", () => {
    expect(describeRefusal({ error: "x", field: "name" }, "?").field).toBe("name");
    expect(describeRefusal({ error: "x", field: "bogus" }, "?").field).toBeNull();
    expect(describeRefusal("plain string", "?")).toEqual({
      field: null,
      message: "?",
    });
  });

  test("a reason with no field goes to a toast; a body with no reason gets the fallback", () => {
    expect(describeRefusal({ error: "no plant yet", field: null }, "?")).toEqual({
      field: null,
      message: "no plant yet",
    });
    expect(describeRefusal(undefined, "Unknown")).toEqual({
      field: null,
      message: "Unknown",
    });
  });
});

describe("groupByConnection", () => {
  const other: ConnectionView = {
    ...gateway,
    id: 4,
    name: "Keller",
    host: "10.0.0.9",
  };
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
    expect(groups.some((g) => g.connection === null)).toBe(false);
  });
});

describe("connectionCaption", () => {
  test("spells transport, address and cadence in seconds", () => {
    expect(connectionCaption(gateway)).toEqual({
      transport: "Modbus TCP",
      host: "10.0.0.5",
      port: 502,
      seconds: 1,
    });
    expect(
      connectionCaption({
        ...gateway,
        transport: "rtu-over-tcp",
        pollIntervalMs: 2500,
      }).transport,
    ).toBe("Modbus RTU over TCP");
    expect(connectionCaption({ ...gateway, pollIntervalMs: 2500 }).seconds).toBe(2.5);
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
