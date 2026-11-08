import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import * as m from "$lib/paraglide/messages";

// mock-hygiene-ignore-next-line -- SvelteKit virtual modules: no real module exists under bun test. The server-side values keep `$lib/core-api` loadable.
mock.module("$app/environment", () => ({ browser: false }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$app/navigation", () => ({ goto: async () => {} }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));

const realCore = await import("$lib/core-api");
const realCoreExports = { ...realCore };

/** The core client as a recorder: every verb, path, path id and body, answered from `coreAnswer`. */
const coreCalls: string[] = [];
let coreAnswer: { data?: unknown; error?: unknown } | "unreachable" = {};
function coreVerb(verb: string) {
  return async (path: string, init?: { params?: { path?: { id?: number } }; body?: unknown }) => {
    const id = init?.params?.path?.id;
    const body = init?.body === undefined ? "" : ` ${JSON.stringify(init.body)}`;
    coreCalls.push(`${verb} ${path}${id === undefined ? "" : ` id=${id}`}${body}`);
    if (coreAnswer === "unreachable") throw new TypeError("Failed to fetch");
    return coreAnswer;
  };
}
mock.module("$lib/core-api", () => ({
  ...realCore,
  core: {
    GET: coreVerb("GET"),
    POST: coreVerb("POST"),
    PATCH: coreVerb("PATCH"),
    DELETE: coreVerb("DELETE"),
  },
}));

afterAll(() => {
  mock.module("$lib/core-api", () => ({ ...realCoreExports }));
});

const { rosterTransport } = await import("./roster-transport");

/** The 4.0 core, which reports integrations absent, and the 3.x engine, which reports nothing. */
const onCore = rosterTransport(() => false);
const onEngine = rosterTransport(() => true);

beforeEach(() => {
  coreCalls.length = 0;
  coreAnswer = { data: { id: 1 } };
});

describe("rosterTransport on the core", () => {
  test("a payload is an ok answer carrying it", async () => {
    expect(await onCore.devices()).toEqual({ ok: true, data: { id: 1 } } as never);
    expect(coreCalls).toEqual(["GET /api/devices"]);
  });

  test("a refusal is a failure carrying the core's body", async () => {
    coreAnswer = { error: { error: "this device has recorded history", field: "history" } };
    expect(await onCore.deleteDevice(3)).toEqual({
      ok: false,
      error: { error: "this device has recorded history", field: "history" },
    });
  });

  test("an unreachable core is a failure with no reason, not a throw", async () => {
    coreAnswer = "unreachable";
    expect(await onCore.devices()).toEqual({ ok: false, error: undefined });
  });

  test("every device and connection call goes to the core, its id in the path", async () => {
    await onCore.addDevice({ a: 1 } as never);
    await onCore.patchDevice(7, { retired: true });
    await onCore.deleteDevice(5);
    await onCore.addConnection({ b: 2 } as never);
    await onCore.patchConnection(4, {} as never);
    await onCore.deleteConnection(8);
    await onCore.profiles();
    expect(coreCalls).toEqual([
      'POST /api/devices {"a":1}',
      'PATCH /api/devices/{id} id=7 {"retired":true}',
      "DELETE /api/devices/{id} id=5",
      'POST /api/connections {"b":2}',
      "PATCH /api/connections/{id} id=4 {}",
      "DELETE /api/connections/{id} id=8",
      "GET /api/profiles",
    ]);
  });

  test("integrations it does not serve are answered empty without a request", async () => {
    expect(await onCore.integrations()).toEqual({ ok: true, data: { integrations: [] } });
    const catalog = await onCore.catalog();
    expect(catalog.ok && catalog.data.mqtt).toEqual([]);
    expect(catalog.ok && catalog.data.internal).toEqual([]);
    expect(
      catalog.ok && catalog.data.modbus.map((entry) => [entry.id, entry.via, entry.label]),
    ).toEqual([["modbus-device", "profile", m.wizard_attach_modbus_device()]]);
    expect(coreCalls).toEqual([]);
  });
});

describe("rosterTransport on a core that serves integrations", () => {
  test("integration calls go to the core by path, the row id in it", async () => {
    await onEngine.integrations();
    await onEngine.catalog();
    await onEngine.addIntegration({ c: 3 } as never);
    await onEngine.patchIntegration(9, { enabled: false });
    await onEngine.deleteIntegration(6);
    expect(coreCalls).toEqual([
      "GET /api/integrations",
      "GET /api/integrations/catalog",
      'POST /api/integrations {"c":3}',
      'PATCH /api/integrations/9 {"enabled":false}',
      "DELETE /api/integrations/6",
    ]);
  });

  test("a refusal is a failure carrying the core's body", async () => {
    coreAnswer = { error: { error: "nope" } };
    expect(await onEngine.integrations()).toEqual({ ok: false, error: { error: "nope" } });
  });

  test("an unreachable core is a failure with no reason, not a throw", async () => {
    coreAnswer = "unreachable";
    expect(await onEngine.catalog()).toEqual({ ok: false, error: undefined });
  });
});
