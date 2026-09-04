import { describe, expect, test } from "bun:test";

import {
  buildAddDeviceBody,
  connectionOptions,
  describeRefusal,
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
