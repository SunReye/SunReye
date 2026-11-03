import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// mock-hygiene-ignore-next-line -- SvelteKit virtual modules: no real module exists under bun test. The server-side values keep `$lib/api` loadable.
mock.module("$app/environment", () => ({ browser: false }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$app/navigation", () => ({ goto: async () => {} }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));

const realApi = await import("$lib/api");
const realApiExports = { ...realApi };
const realCore = await import("$lib/core-api");
const realCoreExports = { ...realCore };

/** Eden's call shape as a recorder: every path and argument list, ending in an answer. */
const trail: string[] = [];
let answer: { data: unknown; error: { value: unknown } | null } = { data: {}, error: null };
function recorder(path: string[]): unknown {
  const target = () => undefined;
  return new Proxy(target, {
    get: (_t, prop) => {
      if (prop === "then") return undefined;
      return recorder([...path, String(prop)]);
    },
    apply: (_t, _this, args) => {
      const last = path.at(-1);
      if (last && ["get", "post", "patch", "delete"].includes(last)) {
        trail.push(`${path.join(".")}(${JSON.stringify(args[0] ?? null)})`);
        return Promise.resolve(answer);
      }
      return recorder([...path, JSON.stringify(args[0])]);
    },
  });
}
mock.module("$lib/api", () => ({ ...realApi, api: recorder(["api"]) }));

/** The core client's `GET`: records the path, answers from `coreAnswer`, or throws like a dead socket. */
const coreCalls: string[] = [];
let coreAnswer: { data?: unknown; error?: unknown } | "unreachable" = {};
mock.module("$lib/core-api", () => ({
  ...realCore,
  core: {
    GET: async (path: string) => {
      coreCalls.push(path);
      if (coreAnswer === "unreachable") throw new TypeError("Failed to fetch");
      return coreAnswer;
    },
  },
}));

afterAll(() => {
  mock.module("$lib/api", () => ({ ...realApiExports }));
  mock.module("$lib/core-api", () => ({ ...realCoreExports }));
});

const { edenRosterTransport } = await import("./roster-transport");

beforeEach(() => {
  trail.length = 0;
  coreCalls.length = 0;
  coreAnswer = {};
  answer = { data: { id: 1 }, error: null };
});

describe("edenRosterTransport", () => {
  test("a payload is an ok answer carrying it", async () => {
    expect(await edenRosterTransport.devices()).toEqual({ ok: true, data: { id: 1 } } as never);
    expect(trail).toEqual(["api.api.devices.get(null)"]);
  });

  test("no payload is a failure carrying the server's reason", async () => {
    answer = { data: null, error: { value: { message: "nope" } } };
    expect(await edenRosterTransport.devices()).toEqual({ ok: false, error: { message: "nope" } });
  });

  test("no payload and no error is a failure with no reason", async () => {
    answer = { data: null, error: null };
    expect(await edenRosterTransport.catalog()).toEqual({ ok: false, error: undefined });
  });

  test("an id reaches the path as a string", async () => {
    await edenRosterTransport.patchDevice(7, { name: "A" } as never);
    await edenRosterTransport.deleteConnection(8);
    await edenRosterTransport.patchIntegration(9, {} as never);
    expect(trail).toEqual([
      'api.api.devices.{"id":"7"}.patch({"name":"A"})',
      'api.api.connections.{"id":"8"}.delete(null)',
      'api.api.integrations.{"id":"9"}.patch({})',
    ]);
  });

  test("each verb goes to its own resource", async () => {
    await edenRosterTransport.integrations();
    await edenRosterTransport.catalog();
    await edenRosterTransport.addDevice({ a: 1 } as never);
    await edenRosterTransport.addConnection({ b: 2 } as never);
    await edenRosterTransport.addIntegration({ c: 3 } as never);
    await edenRosterTransport.patchConnection(4, {} as never);
    await edenRosterTransport.deleteDevice(5);
    await edenRosterTransport.deleteIntegration(6);
    expect(trail).toEqual([
      "api.api.integrations.get(null)",
      "api.api.integrations.catalog.get(null)",
      'api.api.devices.post({"a":1})',
      'api.api.connections.post({"b":2})',
      'api.api.integrations.post({"c":3})',
      'api.api.connections.{"id":"4"}.patch({})',
      'api.api.devices.{"id":"5"}.delete(null)',
      'api.api.integrations.{"id":"6"}.delete(null)',
    ]);
  });
});

describe("edenRosterTransport profiles", () => {
  test("reads the list from the core, not the Elysia API", async () => {
    const list = [
      {
        id: "deye-sg05lp3",
        name: "SG05LP3",
        manufacturer: "Deye",
        active: true,
        installed: false,
        builtin: true,
      },
    ];
    coreAnswer = { data: list };
    expect(await edenRosterTransport.profiles()).toEqual({ ok: true, data: list });
    expect(coreCalls).toEqual(["/api/profiles"]);
    expect(trail).toEqual([]);
  });

  test("an empty list is still the core's answer", async () => {
    coreAnswer = { data: [] };
    expect(await edenRosterTransport.profiles()).toEqual({ ok: true, data: [] });
  });

  test("the core's refusal is a failure carrying its body", async () => {
    coreAnswer = { error: { error: "forbidden" } };
    expect(await edenRosterTransport.profiles()).toEqual({
      ok: false,
      error: { error: "forbidden" },
    });
  });

  test("an unreachable core is a failure with no reason, not a throw", async () => {
    coreAnswer = "unreachable";
    expect(await edenRosterTransport.profiles()).toEqual({ ok: false, error: undefined });
  });
});
