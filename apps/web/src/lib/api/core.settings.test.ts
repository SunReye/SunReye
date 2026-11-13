/// <reference types="bun" />
import { expect, test } from "bun:test";
import { connect, type Attempt, type Capabilities, type Transport } from "./core.ts";
import { BASE, problem, scripted } from "./core.harness.ts";

function recording(response: Response): Transport & { readonly asked: string[] } {
  const asked: string[] = [];

  return {
    base: BASE,
    asked,
    fetch: async (request) => {
      asked.push(`${request.method} ${request.url} ${await request.text()}`.trimEnd());

      return response;
    },
  };
}

test("a setting is written under the device with its value, and answers the attempt", async () => {
  const entry: Attempt = {
    time: "2026-11-09T00:00:00Z",
    device: 1,
    setting: "battery.max_charge_current",
    before: 108,
    requested: 50,
    after: 50,
    outcome: "verified",
    failedStep: null,
    actor: "admin",
  };

  const transport = recording(Response.json(entry));

  const written = await connect(transport).write(1, "battery.max_charge_current", 50);

  expect(transport.asked).toEqual([
    `PUT ${BASE}api/v1/devices/1/settings/battery.max_charge_current {"value":50}`,
  ]);
  expect(written).toEqual(entry);
});

test("a setting's current value is read under the device, null when unknown", async () => {
  const known = recording(Response.json({ value: 108 }));
  const unknown = recording(Response.json({ value: null }));

  expect(await connect(known).read(1, "battery.max_charge_current")).toEqual({ value: 108 });
  expect(await connect(unknown).read(1, "work_mode")).toEqual({ value: null });
  expect([...known.asked, ...unknown.asked]).toEqual([
    `GET ${BASE}api/v1/devices/1/settings/battery.max_charge_current`,
    `GET ${BASE}api/v1/devices/1/settings/work_mode`,
  ]);
});

test("a refused read reports the problem code", async () => {
  const core = connect(scripted(problem(404, "setting.none")));

  expect(await core.read(1, "bogus")).toEqual({ problem: "setting.none" });
});

test("a refused write reports the problem code", async () => {
  const core = connect(scripted(problem(409, "setting.writes-off")));

  expect(await core.write(1, "work_mode", 1)).toEqual({ problem: "setting.writes-off" });
});

test("capabilities and the write log are read from the core", async () => {
  const support: Capabilities = {
    version: "5.0.0",
    schema: { min: 1, max: 1 },
    capabilities: [],
    transports: [],
    devices: {},
  };

  const capabilities = recording(Response.json(support));
  const log = recording(Response.json({ writes: [] }));

  expect(await connect(capabilities).capabilities()).toEqual(support);
  expect(await connect(log).writes()).toEqual({ writes: [] });
  expect([...capabilities.asked, ...log.asked]).toEqual([
    `GET ${BASE}api/v1/capabilities`,
    `GET ${BASE}api/v1/writes`,
  ]);
});

test("the devices are listed from the core", async () => {
  const device = { id: 1, name: "Deye", profile: "deye-sg05lp3", connection: 1, unit: 1 };
  const listed = recording(Response.json({ devices: [device] }));

  expect(await connect(listed).devices()).toEqual([device]);
  expect(listed.asked).toEqual([`GET ${BASE}api/v1/devices`]);
});

test("a device is removed by its id", async () => {
  const transport = recording(new Response(null, { status: 204 }));

  expect(await connect(transport).removeDevice(4)).toBeUndefined();
  expect(transport.asked).toEqual([`DELETE ${BASE}api/v1/devices/4`]);
});

test("a broker is added with its topic root and secrets, and its secrets are only named back", async () => {
  const created = {
    id: 2,
    name: "EVCC",
    transport: "mqtt",
    host: "evcc.lan",
    port: 1883,
    topicRoot: "evcc",
    secrets: ["password", "username"],
  };

  const transport = recording(Response.json(created, { status: 201 }));

  const answer = await connect(transport).addConnection({
    name: "EVCC",
    transport: "mqtt",
    host: "evcc.lan",
    port: 1883,
    topicRoot: "evcc",
    secrets: { username: "sunreye", password: "hunter2" },
  });

  expect(transport.asked).toEqual([
    `POST ${BASE}api/v1/connections {"name":"EVCC","transport":"mqtt","host":"evcc.lan","port":1883,"topicRoot":"evcc","secrets":{"username":"sunreye","password":"hunter2"}}`,
  ]);
  expect(answer).toEqual(created);
});

test("a connection is changed and removed by its id; a removal in use reports the problem code", async () => {
  const changed = recording(
    Response.json({
      id: 2,
      name: "Gateway",
      transport: "modbus-tcp",
      host: "10.0.0.9",
      port: 502,
      secrets: [],
    }),
  );

  await connect(changed).changeConnection(2, {
    name: "Gateway",
    transport: "modbus-tcp",
    host: "10.0.0.9",
    port: 502,
  });

  expect(changed.asked).toEqual([
    `PUT ${BASE}api/v1/connections/2 {"name":"Gateway","transport":"modbus-tcp","host":"10.0.0.9","port":502}`,
  ]);
  expect(await connect(scripted(problem(409, "connection.in-use"))).removeConnection(2)).toEqual({
    problem: "connection.in-use",
  });
});
