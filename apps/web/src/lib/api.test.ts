import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// mock-hygiene-ignore-next-line -- SvelteKit virtual module: no real module exists under bun test. Server-side while the client loads, flipped to the browser per case.
mock.module("$app/environment", () => ({ browser: false }));
const gone: string[] = [];
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$app/navigation", () => ({ goto: async (to: string) => void gone.push(to) }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));
const observed: Array<[number, unknown]> = [];
// mock-hygiene-ignore-next-line -- a rune module: it cannot be compiled, so cannot be imported, under bun test.
mock.module("$lib/history-incomplete.svelte", () => ({
  historyIncomplete: { observe: (status: number, body: unknown) => observed.push([status, body]) },
}));

afterAll(() => {
  // mock-hygiene-ignore-next-line -- same virtual module, handed back as the server-side value.
  mock.module("$app/environment", () => ({ browser: false }));
});

const { api } = await import("./api");

/** One request through the real client, answered by `fetch` with `status` and `body`. */
async function request(status: number, body = "{}") {
  const response = new Response(body, { status });
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
  // The path is arbitrary: the hook sees every response whatever route asked.
  await (api as unknown as { probe: { get(): Promise<unknown> } }).probe.get();
  return response;
}

const realFetch = globalThis.fetch;
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
  observed.length = 0;
  at("#/history");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.location = realLocation;
});

describe("a 401", () => {
  test("bounces to the login route from any other page", async () => {
    await request(401);
    expect(gone).toEqual(["/app/#/login"]);
  });

  test.each(["#/login", "#/onboarding", "#/setup", "#/setup?step=2"])(
    "does not bounce from the pre-auth page %s",
    async (hash) => {
      at(hash);
      await request(401);
      expect(gone).toEqual([]);
    },
  );

  test("other failures do not bounce", async () => {
    await request(403);
    await request(500);
    expect(gone).toEqual([]);
  });

  test("outside the browser nothing bounces", async () => {
    // mock-hygiene-ignore-next-line -- same virtual module, flipped to the server for one case.
    mock.module("$app/environment", () => ({ browser: false }));
    await request(401);
    expect(gone).toEqual([]);
  });
});

describe("a 422", () => {
  test("hands the parsed body to the incomplete-range banner", async () => {
    await request(422, JSON.stringify({ error: "history incomplete" }));
    await Bun.sleep(10);
    expect(observed).toEqual([[422, { error: "history incomplete" }]]);
  });

  test("a non-JSON 422 is somebody else's: nothing observed, nothing thrown", async () => {
    await request(422, "not json");
    await Bun.sleep(10);
    expect(observed).toEqual([]);
  });

  test("other statuses are never read", async () => {
    await request(200);
    await request(404);
    await Bun.sleep(10);
    expect(observed).toEqual([]);
  });
});

test("the client sends the session cookie", async () => {
  let init: RequestInit | undefined;
  globalThis.fetch = (async (_input: unknown, i?: RequestInit) => {
    init = i;
    return new Response("{}");
  }) as unknown as typeof fetch;
  await (api as unknown as { probe: { get(): Promise<unknown> } }).probe.get();
  expect(init?.credentials).toBe("include");
});
