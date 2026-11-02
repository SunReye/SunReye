import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import createClient from "openapi-fetch";
import { get } from "svelte/store";
import type { components, paths } from "$lib/core-api.gen";

// mock-hygiene-ignore-next-line -- SvelteKit virtual modules: no real module exists under bun test. The server-side values keep `$lib/core-api` loadable.
mock.module("$app/environment", () => ({ browser: false }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));

const realCore = await import("$lib/core-api");
const realCoreExports = { ...realCore };

type Account = components["schemas"]["Account"];
type Answer = { data?: unknown; error?: unknown };
const calls: Array<{ verb: string; path: string; init?: unknown }> = [];
let answer: (verb: string, path: string) => Answer | Promise<Answer> = () => ({});
const verb = (name: string) => async (path: string, init?: unknown) => {
  calls.push({ verb: name, path, init });
  return answer(name, path);
};
mock.module("$lib/core-api", () => ({
  ...realCoreExports,
  core: { GET: verb("GET"), POST: verb("POST"), DELETE: verb("DELETE") },
}));

afterAll(() => {
  mock.module("$lib/core-api", () => ({ ...realCoreExports }));
});

const session = await import("./session");

/** `DELETE /api/auth/session` answered through the real openapi-fetch client, so the answer has its real shape. */
function deleteAnswers(status: number, body?: unknown, headers?: HeadersInit) {
  const client = createClient<paths>({
    baseUrl: "http://core.test",
    fetch: async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
      }),
  });
  return () => client.DELETE("/api/auth/session");
}

const ada: Account = { id: 1, name: "Ada", email: "ada@example.com", admin: true };
const signedOut = { data: null, isPending: false };

afterEach(async () => {
  answer = () => ({});
  await session.signOut();
  calls.length = 0;
});

describe("useAppSession", () => {
  test("starts pending, then holds the account the core names", async () => {
    answer = () => ({ data: ada });
    const store = session.useAppSession();
    expect(get(store)).toEqual({ data: null, isPending: true });
    await session.refreshSession();
    expect(get(store)).toEqual({ data: { user: ada }, isPending: false });
    expect(calls[0]).toMatchObject({ verb: "GET", path: "/api/auth/session" });
  });

  test("a 401 settles as anonymous", async () => {
    answer = () => ({ error: { error: "Not signed in" } });
    await session.refreshSession();
    expect(get(session.useAppSession())).toEqual(signedOut);
  });

  test("a core that cannot be reached settles as anonymous", async () => {
    answer = () => ({ data: ada });
    await session.signIn({ email: "ada@example.com", password: "pw" });
    expect(get(session.useAppSession()).data).toEqual({ user: ada });
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    await session.refreshSession();
    expect(get(session.useAppSession())).toEqual(signedOut);
  });
});

describe("signIn", () => {
  test("posts the credentials and holds the account", async () => {
    answer = () => ({ data: ada });
    const result = await session.signIn({
      email: "ada@example.com",
      password: "pw",
      rememberMe: true,
    });
    expect(result).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({
      verb: "POST",
      path: "/api/auth/login",
      init: { body: { email: "ada@example.com", password: "pw", rememberMe: true } },
    });
    expect(get(session.useAppSession()).data).toEqual({ user: ada });
  });

  test("a refusal carries the core's reason and leaves the session empty", async () => {
    answer = () => ({ error: { error: "Wrong email or password" } });
    expect(await session.signIn({ email: "a@b.c", password: "x" })).toEqual({
      ok: false,
      message: "Wrong email or password",
    });
    expect(get(session.useAppSession()).data).toBeNull();
  });

  test("an unreachable core is a failure with no message", async () => {
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await session.signIn({ email: "a@b.c", password: "x" })).toEqual({ ok: false });
  });
});

describe("signUp", () => {
  test("posts the account and holds it: sign-up logs in", async () => {
    answer = () => ({ data: ada });
    const result = await session.signUp({ name: "Ada", email: "ada@example.com", password: "pw" });
    expect(result).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ verb: "POST", path: "/api/auth/sign-up" });
    expect(get(session.useAppSession()).data).toEqual({ user: ada });
  });

  test("a closed registration is a refusal", async () => {
    answer = () => ({ error: { error: "Sign-up is closed" } });
    expect(await session.signUp({ name: "E", email: "e@e.e", password: "pw" })).toEqual({
      ok: false,
      message: "Sign-up is closed",
    });
  });
});

describe("signOut", () => {
  async function signedInAs(account: Account) {
    answer = () => ({ data: account });
    await session.signIn({ email: account.email, password: "pw" });
    calls.length = 0;
  }

  test("deletes the session and clears it", async () => {
    await signedInAs(ada);
    answer = deleteAnswers(204);
    expect(await session.signOut()).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ verb: "DELETE", path: "/api/auth/session" });
    expect(get(session.useAppSession())).toEqual(signedOut);
  });

  test("a refused sign-out keeps the account and reports why", async () => {
    await signedInAs(ada);
    answer = deleteAnswers(403, { error: "Origin not allowed" });
    expect(await session.signOut()).toEqual({ ok: false, message: "Origin not allowed" });
    expect(get(session.useAppSession()).data).toEqual({ user: ada });
  });

  test("a 401 means the session is already gone, so the account clears", async () => {
    await signedInAs(ada);
    answer = deleteAnswers(401, { error: "Not signed in" });
    expect(await session.signOut()).toEqual({ ok: true });
    expect(get(session.useAppSession())).toEqual(signedOut);
  });

  test("a failure with an empty body keeps the account", async () => {
    await signedInAs(ada);
    answer = deleteAnswers(502, undefined, { "content-length": "0" });
    expect(await session.signOut()).toEqual({ ok: false, message: "" });
    expect(get(session.useAppSession()).data).toEqual({ user: ada });
  });

  test("clears the session even when the core cannot be reached", async () => {
    await signedInAs(ada);
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    await session.signOut();
    expect(get(session.useAppSession())).toEqual(signedOut);
  });
});
