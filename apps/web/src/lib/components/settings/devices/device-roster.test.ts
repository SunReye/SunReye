import { describe, expect, test } from "bun:test";

import type { Catalog } from "../wizard/add-wizard";
import type { RegisteredProfile } from "../profile-types";
import {
  type Answer,
  type RosterState,
  createDeviceRoster,
  type RosterTransport,
  emptyRosterState,
  failureText,
  placeFailure,
  statedReason,
} from "./device-roster";
import type { ConnectionView, DeviceView, IntegrationView } from "./device-types";
import * as m from "$lib/paraglide/messages";

/**
 * The roster module against an IN-MEMORY transport — the second adapter beside
 * the Eden one, and the reason the seam exists. What is proven: every write's
 * outcome, which lists a write re-reads (and that a refused write re-reads
 * nothing), and the words a failure carries.
 */

const gateway = {
  id: 1,
  name: "Inverter",
  kind: "modbus",
  params: { host: "10.0.0.5", port: 502, transport: "tcp", timeoutMs: 2000, pollIntervalMs: 1000 },
} satisfies ConnectionView;

const broker = {
  id: 2,
  name: "Home broker",
  kind: "mqtt",
  params: { brokerUrl: "mqtt://hass.ee.lan:1883", hasPassword: false },
} satisfies ConnectionView;

const device = (over: Partial<DeviceView> = {}): DeviceView => ({
  id: 1,
  slug: "inverter",
  name: "Inverter",
  profileId: "deye",
  role: "inverter",
  unitId: 1,
  connectionId: 1,
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

const ingest: IntegrationView = {
  id: 5,
  kind: "evcc-ingest",
  connectionId: 2,
  enabled: true,
  params: { topicRoot: "evcc" },
  label: "EVCC",
  addable: true,
  multiInstance: true,
  status: null,
};

const CATALOG: Catalog = { modbus: [], mqtt: [], internal: [] };
const PROFILES: RegisteredProfile[] = [
  { id: "deye", name: "Deye", manufacturer: "Deye", active: true, installed: true, builtin: true },
];

const ok = <T>(data: T): Answer<T> => ({ ok: true, data });
const no = (error: unknown): Answer<never> => ({ ok: false, error });

type Scripted = { [K in keyof RosterTransport]?: Answer<unknown> };

/**
 * Records every call by name and answers from a script — a list read answers
 * the fixture unless the script says otherwise, a write answers ok with its body.
 */
class FakeTransport implements RosterTransport {
  calls: { name: string; args: unknown[] }[] = [];
  script: Scripted = {};
  #answer<T>(name: keyof RosterTransport, fallback: T, args: unknown[]): Promise<Answer<T>> {
    this.calls.push({ name, args });
    return Promise.resolve((this.script[name] as Answer<T> | undefined) ?? ok(fallback));
  }
  names = () => this.calls.map((c) => c.name);
  devices = () =>
    this.#answer("devices", { devices: [device()], connections: [gateway, broker] }, []);
  integrations = () => this.#answer("integrations", { integrations: [ingest] }, []);
  catalog = () => this.#answer("catalog", CATALOG, []);
  profiles = () => this.#answer("profiles", PROFILES, []);
  addDevice = (body: unknown) =>
    this.#answer("addDevice", device({ id: 42, name: "Meter" }), [body]);
  patchDevice = (id: number, body: unknown) =>
    this.#answer("patchDevice", device({ id, name: "Renamed" }), [id, body]);
  deleteDevice = (id: number) => this.#answer("deleteDevice", { ok: true, id }, [id]);
  addConnection = (body: unknown) =>
    this.#answer("addConnection", { ...gateway, id: 9, name: "New" }, [body]);
  patchConnection = (id: number, body: unknown) =>
    this.#answer("patchConnection", { ...gateway, id }, [id, body]);
  deleteConnection = (id: number) => this.#answer("deleteConnection", { ok: true, id }, [id]);
  addIntegration = (body: unknown) => this.#answer("addIntegration", { id: 9 }, [body]);
  patchIntegration = (id: number, body: unknown) =>
    this.#answer("patchIntegration", ingest, [id, body]);
  deleteIntegration = (id: number) => this.#answer("deleteIntegration", { ok: true, id }, [id]);
}

function setup(afterWrite: "reload" | "leave" = "reload") {
  const transport = new FakeTransport();
  const state: RosterState = emptyRosterState();
  const roster = createDeviceRoster(transport, state, { afterWrite });
  return { transport, state, roster };
}

/** A roster that has loaded once, with the load's own calls forgotten. */
async function loaded(afterWrite: "reload" | "leave" = "reload") {
  const it = setup(afterWrite);
  await it.roster.load();
  it.transport.calls = [];
  return it;
}

describe("load", () => {
  test("reads the roster, the integration rows and the catalog — not the profiles", async () => {
    const { transport, roster } = setup();
    await roster.load();
    expect(transport.names().sort()).toEqual(["catalog", "devices", "integrations"]);
    expect(roster.devices.map((d) => d.id)).toEqual([1]);
    expect(roster.connections.map((c) => c.id)).toEqual([1, 2]);
    expect(roster.integrations).toEqual([ingest]);
    expect(roster.catalog).toBe(CATALOG);
    expect(roster.loaded).toBe(true);
    expect(roster.loadFailed).toBe(false);
  });

  test("a failed roster read says so, and is not 'loaded'", async () => {
    const { transport, roster } = setup();
    transport.script.devices = no(undefined);
    await roster.load();
    expect(roster.loadFailed).toBe(true);
    expect(roster.loaded).toBe(false);
    expect(roster.devices).toEqual([]);
  });

  test("a failed side read keeps what was there", async () => {
    const { transport, roster } = await loaded();
    transport.script.integrations = no(undefined);
    transport.script.catalog = no(undefined);
    await roster.load();
    expect(roster.integrations).toEqual([ingest]);
    expect(roster.catalog).toBe(CATALOG);
  });

  test("profiles are their own read", async () => {
    const { transport, roster } = setup();
    await roster.loadProfiles();
    expect(transport.names()).toEqual(["profiles"]);
    expect(roster.profiles).toEqual(PROFILES);
  });

  test("a failed profile read keeps the list it had", async () => {
    const { transport, roster } = setup();
    await roster.loadProfiles();
    transport.script.profiles = no(undefined);
    await roster.loadProfiles();
    expect(roster.profiles).toEqual(PROFILES);
  });
});

describe("groups", () => {
  test("nothing before the roster answers — 'not yet' is not 'empty'", () => {
    expect(setup().roster.groups).toEqual([]);
  });

  test("one card per connection, the integration rows folded in", async () => {
    const { roster } = await loaded();
    const keys = roster.groups.map((g) => g.key);
    expect(keys).toEqual(["gateway-1", "gateway-2"]);
    expect(roster.groups[1]?.integrations).toEqual([ingest]);
  });
});

describe("device writes", () => {
  test("patch answers the saved row and re-reads the roster only", async () => {
    const { transport, roster } = await loaded();
    const outcome = await roster.patch(1, { name: "Renamed" });
    expect(outcome).toEqual({ kind: "ok", value: device({ name: "Renamed" }) });
    expect(transport.calls).toEqual([
      { name: "patchDevice", args: [1, { name: "Renamed" }] },
      { name: "devices", args: [] },
    ]);
  });

  test("a refusal naming a field lands on that field, and nothing is re-read", async () => {
    const { transport, roster } = await loaded();
    transport.script.patchDevice = no({ error: "unit id 1 is taken", field: "unitId" });
    const outcome = await roster.patch(1, { unitId: 1 });
    expect(outcome).toEqual({
      kind: "refused",
      field: "unitId",
      reason: "unit id 1 is taken",
      text: "unit id 1 is taken",
    });
    expect(transport.names()).toEqual(["patchDevice"]);
  });

  test("a refusal naming a field it has no reason for falls back to 'unknown'", async () => {
    const { transport, roster } = await loaded();
    transport.script.patchDevice = no({ field: "name" });
    expect(await roster.patch(1, { name: "x" })).toEqual({
      kind: "refused",
      field: "name",
      reason: m.error_unknown(),
      text: '{"field":"name"}',
    });
  });

  test("a field refusal with no `error` still reads as the body says, for a toast", async () => {
    // The toasts read the whole body (`apiErrorText`); only the field message
    // under the input falls back to "unknown". Both were so before the roster.
    const { transport, roster } = await loaded();
    transport.script.patchDevice = no({ field: "name", summary: "Expected string" });
    const outcome = await roster.patch(1, { name: "x" });
    expect(outcome).toEqual({
      kind: "refused",
      field: "name",
      reason: m.error_unknown(),
      text: "Expected string",
    });
    expect(outcome.kind !== "ok" && failureText(outcome)).toBe("Expected string");
    expect(outcome.kind !== "ok" && statedReason(outcome)).toBe(m.error_unknown());
  });

  test("a refusal naming no field it knows is an error with the server's words", async () => {
    const { transport, roster } = await loaded();
    transport.script.patchDevice = no({ error: "nothing to change", field: "history-ish" });
    expect(await roster.patch(1, {})).toEqual({
      kind: "error",
      text: "nothing to change",
      stated: "nothing to change",
    });
  });

  test("a dead request is an error with the fallback words", async () => {
    const { transport, roster } = await loaded();
    transport.script.patchDevice = no(undefined);
    expect(await roster.patch(1, {})).toEqual({
      kind: "error",
      text: m.error_unknown(),
      stated: null,
    });
  });

  test("a plain-text body is its own reason, and states no sentence", async () => {
    const { transport, roster } = await loaded();
    transport.script.patchDevice = no("Internal Server Error");
    expect(await roster.patch(1, {})).toEqual({
      kind: "error",
      text: "Internal Server Error",
      stated: null,
    });
  });

  test("a validation body is read for its summary, never '[object Object]'", async () => {
    const { transport, roster } = await loaded();
    transport.script.patchDevice = no({ summary: "Expected number" });
    expect(await roster.patch(1, {})).toEqual({
      kind: "error",
      text: "Expected number",
      stated: null,
    });
  });

  test("retire and restore are the patch's `retired` flag", async () => {
    const { transport, roster } = await loaded();
    await roster.retire(3);
    await roster.restore(3);
    expect(transport.calls.filter((c) => c.name === "patchDevice")).toEqual([
      { name: "patchDevice", args: [3, { retired: true }] },
      { name: "patchDevice", args: [3, { retired: false }] },
    ]);
  });

  test("delete answers ok and re-reads the roster", async () => {
    const { transport, roster } = await loaded();
    expect(await roster.delete(2)).toEqual({ kind: "ok", value: { ok: true, id: 2 } });
    expect(transport.names()).toEqual(["deleteDevice", "devices"]);
  });

  test("a refusal with no field is an error carrying the server's sentence", async () => {
    const { transport, roster } = await loaded();
    transport.script.deleteDevice = no({ error: "this device is being polled", field: null });
    expect(await roster.delete(1)).toEqual({
      kind: "error",
      text: "this device is being polled",
      stated: "this device is being polled",
    });
  });

  test("a device with readings is the has-history outcome, not an error", async () => {
    const { transport, roster } = await loaded();
    transport.script.deleteDevice = no({ error: "has history; retire it", field: "history" });
    expect(await roster.delete(1)).toEqual({ kind: "has-history" });
    expect(transport.names()).toEqual(["deleteDevice"]);
  });
});

describe("add — the one path both add flows take", () => {
  const body = {
    connection: { id: 1 },
    role: "meter" as const,
    unitId: 2,
    name: "Meter",
    profileId: "deye",
  };

  test("a device submission posts the device and re-reads the roster", async () => {
    const { transport, roster } = await loaded();
    const outcome = await roster.add({ target: "device", body });
    expect(outcome.kind).toBe("ok");
    expect(transport.calls).toEqual([
      { name: "addDevice", args: [body] },
      { name: "devices", args: [] },
    ]);
  });

  test("an integration submission posts the integration and re-reads both lists", async () => {
    const { transport, roster } = await loaded();
    const integration = { kind: "evcc-ingest", connectionId: 2, params: {} };
    await roster.add({ target: "integration", body: integration });
    expect(transport.calls[0]).toEqual({ name: "addIntegration", args: [integration] });
    expect(transport.names().slice(1).sort()).toEqual(["devices", "integrations"]);
  });

  test("a flow that leaves when it is done re-reads nothing", async () => {
    const { transport, roster } = await loaded("leave");
    await roster.add({ target: "device", body });
    expect(transport.names()).toEqual(["addDevice"]);
  });

  test("a refused add is refused", async () => {
    const { transport, roster } = await loaded();
    transport.script.addDevice = no({ error: "name is taken", field: "name" });
    expect(await roster.add({ target: "device", body })).toEqual({
      kind: "refused",
      field: "name",
      reason: "name is taken",
      text: "name is taken",
    });
  });
});

describe("connection writes", () => {
  const create = {
    name: "New",
    kind: "modbus" as const,
    params: gateway.params,
  };

  test("adding one re-reads the roster the connections arrive in", async () => {
    const { transport, roster } = await loaded();
    const outcome = await roster.addConnection(create);
    expect(outcome).toEqual({ kind: "ok", value: { ...gateway, id: 9, name: "New" } });
    expect(transport.names()).toEqual(["addConnection", "devices"]);
  });

  test("a flow that leaves keeps the new row without a re-read", async () => {
    const { transport, roster } = await loaded("leave");
    await roster.addConnection(create);
    expect(transport.names()).toEqual(["addConnection"]);
    expect(roster.connections.map((c) => c.id)).toEqual([1, 2, 9]);
  });

  test("a new connection before the roster answered is still kept", async () => {
    const { roster } = setup("leave");
    await roster.addConnection(create);
    expect(roster.connections.map((c) => c.id)).toEqual([9]);
  });

  test("patch and delete re-read the roster", async () => {
    const { transport, roster } = await loaded();
    await roster.patchConnection(1, { name: "Renamed", params: gateway.params });
    await roster.deleteConnection(1);
    expect(transport.names()).toEqual([
      "patchConnection",
      "devices",
      "deleteConnection",
      "devices",
    ]);
  });

  test("a failed write re-reads nothing", async () => {
    const { transport, roster } = await loaded();
    transport.script.deleteConnection = no({ error: "still in use" });
    expect(await roster.deleteConnection(1)).toEqual({
      kind: "error",
      text: "still in use",
      stated: "still in use",
    });
    expect(transport.names()).toEqual(["deleteConnection"]);
  });
});

describe("integration writes", () => {
  test("patch re-reads both lists — removing an ingest retires its loadpoints", async () => {
    const { transport, roster } = await loaded();
    const outcome = await roster.patchIntegration(5, { enabled: false });
    expect(outcome.kind).toBe("ok");
    expect(transport.calls[0]).toEqual({ name: "patchIntegration", args: [5, { enabled: false }] });
    expect(transport.names().slice(1).sort()).toEqual(["devices", "integrations"]);
  });

  test("remove re-reads both lists", async () => {
    const { transport, roster } = await loaded();
    await roster.removeIntegration(5);
    expect(transport.names()[0]).toBe("deleteIntegration");
    expect(transport.names().slice(1).sort()).toEqual(["devices", "integrations"]);
  });

  test("a page about the row can remove it and leave, re-reading nothing", async () => {
    const { transport, roster } = await loaded();
    await roster.removeIntegration(5, "leave");
    expect(transport.names()).toEqual(["deleteIntegration"]);
  });

  test("a refused integration write is refused and re-reads nothing", async () => {
    const { transport, roster } = await loaded();
    transport.script.patchIntegration = no({ error: "kind is fixed", field: "kind" });
    expect(await roster.patchIntegration(5, { enabled: true })).toEqual({
      kind: "error",
      text: "kind is fixed",
      stated: "kind is fixed",
    });
    expect(transport.names()).toEqual(["patchIntegration"]);
  });
});

describe("the words a failure is", () => {
  test("failureText says the readable reason of every arm", () => {
    expect(failureText({ kind: "refused", field: "name", reason: "taken", text: "taken" })).toBe(
      "taken",
    );
    expect(failureText({ kind: "error", text: "{}", stated: null })).toBe("{}");
    expect(failureText({ kind: "has-history" })).toBe(m.error_unknown());
  });

  test("statedReason says only the server's own sentence, else 'unknown'", () => {
    expect(statedReason({ kind: "refused", field: "name", reason: "taken", text: "taken" })).toBe(
      "taken",
    );
    expect(statedReason({ kind: "error", text: "down", stated: "down" })).toBe("down");
    expect(statedReason({ kind: "error", text: "{}", stated: null })).toBe(m.error_unknown());
    expect(statedReason({ kind: "has-history" })).toBe(m.error_unknown());
  });

  test("an empty sentence is no sentence", async () => {
    const { transport, roster } = await loaded();
    transport.script.deleteDevice = no({ error: "" });
    const outcome = await roster.delete(1);
    expect(outcome.kind === "error" && outcome.stated).toBeNull();
  });
});

/**
 * Where a failed write is said. A dialog with one field (the rename) used to
 * keep a refusal naming any OTHER field, or none, in state nothing rendered —
 * the Save did nothing visible. Every failure has to land somewhere.
 */
describe("where a failure is said", () => {
  const refused = (field: "name" | "role") =>
    ({ kind: "refused", field, reason: "taken", text: "taken, pick another" }) as const;

  test("a refusal naming a field the form has goes under it, in its readable words", () => {
    expect(placeFailure(refused("name"), ["name"])).toEqual({
      kind: "field",
      refusal: { field: "name", message: "taken, pick another" },
    });
  });

  test("a refusal naming a field the form does NOT have is a toast", () => {
    expect(placeFailure(refused("role"), ["name"])).toEqual({
      kind: "toast",
      text: "taken, pick another",
    });
  });

  test("a failure naming no field is a toast", () => {
    expect(placeFailure({ kind: "error", text: "gateway down", stated: null }, ["name"])).toEqual({
      kind: "toast",
      text: "gateway down",
    });
  });

  test("a history refusal on a form that cannot offer retiring is a toast saying 'unknown'", () => {
    expect(placeFailure({ kind: "has-history" }, ["name"])).toEqual({
      kind: "toast",
      text: m.error_unknown(),
    });
  });

  test("a form with no fields toasts every refusal", () => {
    expect(placeFailure(refused("name"), [])).toEqual({
      kind: "toast",
      text: "taken, pick another",
    });
  });
});
