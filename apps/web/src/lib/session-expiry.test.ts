import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// mock-hygiene-ignore-next-line -- SvelteKit virtual module: no real module exists under bun test. Server-side while the client loads, flipped to the browser per case.
mock.module("$app/environment", () => ({ browser: false }));
const gone: string[] = [];
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$app/navigation", () => ({ goto: async (to: string) => void gone.push(to) }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));

afterAll(() => {
  // mock-hygiene-ignore-next-line -- same virtual module, handed back as the server-side value.
  mock.module("$app/environment", () => ({ browser: false }));
});

const { core } = await import("./core-api");

/** One request through the real `core` client, answered with `status`. */
async function request(path: "/api/history/rollup" | "/api/auth/session", status: number) {
  const fetch = (async () => new Response("{}", { status })) as unknown as typeof globalThis.fetch;
  await core.GET(path as "/api/auth/session", { fetch });
  // The bounce loads `$app/navigation` lazily.
  await Bun.sleep(5);
}

const realLocation = globalThis.location;
const at = (hash: string) => {
  globalThis.location = {
    href: `http://host/app/${hash}`,
    pathname: "/app/",
    search: "",
  } as Location;
};

beforeEach(() => {
  // mock-hygiene-ignore-next-line -- same virtual module, set to the browser for each case.
  mock.module("$app/environment", () => ({ browser: true }));
  gone.length = 0;
  at("#/history");
});

afterEach(() => {
  globalThis.location = realLocation;
});

describe("a 401 on the core client", () => {
  test("bounces to the login route once", async () => {
    await request("/api/history/rollup", 401);
    expect(gone).toEqual(["/app/#/login"]);
  });

  test.each(["#/login", "#/onboarding", "#/setup", "#/setup?step=2"])(
    "does not bounce from the pre-auth page %s",
    async (hash) => {
      at(hash);
      await request("/api/history/rollup", 401);
      expect(gone).toEqual([]);
    },
  );

  test("other refusals do not bounce", async () => {
    await request("/api/history/rollup", 403);
    await request("/api/history/rollup", 500);
    expect(gone).toEqual([]);
  });

  test("outside the browser nothing bounces", async () => {
    // mock-hygiene-ignore-next-line -- same virtual module, flipped to the server for one case.
    mock.module("$app/environment", () => ({ browser: false }));
    await request("/api/history/rollup", 401);
    expect(gone).toEqual([]);
  });

  test("the session probe's 401 is an anonymous visitor, not an expiry", async () => {
    await request("/api/auth/session", 401);
    expect(gone).toEqual([]);
  });
});
