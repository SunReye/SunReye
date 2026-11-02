import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";

// mock-hygiene-ignore-next-line -- SvelteKit virtual modules: no real module exists under bun test. The server-side values keep `$lib/core-api` loadable.
mock.module("$app/environment", () => ({ browser: false }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));

const realCore = await import("$lib/core-api");
const realCoreExports = { ...realCore };

type Answer = { data?: unknown; error?: unknown };
const calls: Array<{ verb: string; path: string; init?: unknown }> = [];
let answer: () => Answer | Promise<Answer> = () => ({});
const verb = (name: string) => async (path: string, init?: unknown) => {
  calls.push({ verb: name, path, init });
  return answer();
};
mock.module("$lib/core-api", () => ({
  ...realCoreExports,
  core: { GET: verb("GET"), PUT: verb("PUT") },
}));

afterAll(() => {
  mock.module("$lib/core-api", () => ({ ...realCoreExports }));
});

const { kioskEnabled, setKiosk } = await import("./kiosk");

afterEach(() => {
  answer = () => ({});
  calls.length = 0;
});

describe("kioskEnabled", () => {
  test("is the core's switch", async () => {
    answer = () => ({ data: { enabled: true } });
    expect(await kioskEnabled()).toBe(true);
    answer = () => ({ data: { enabled: false } });
    expect(await kioskEnabled()).toBe(false);
    expect(calls.map((c) => `${c.verb} ${c.path}`)).toEqual(["GET /api/kiosk", "GET /api/kiosk"]);
  });

  test("a refusal or an unreachable core is off, so the visitor gets the login page", async () => {
    answer = () => ({ error: { error: "internal error" } });
    expect(await kioskEnabled()).toBe(false);
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await kioskEnabled()).toBe(false);
  });
});

describe("setKiosk", () => {
  test("sends the switch and is true once the core took it", async () => {
    answer = () => ({ data: { enabled: true } });
    expect(await setKiosk(true)).toBe(true);
    expect(calls).toEqual([
      { verb: "PUT", path: "/api/settings/kiosk", init: { body: { enabled: true } } },
    ]);
  });

  test("is false when the core refused or could not be reached", async () => {
    answer = () => ({ error: { error: "Admin only" } });
    expect(await setKiosk(false)).toBe(false);
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await setKiosk(false)).toBe(false);
  });
});
