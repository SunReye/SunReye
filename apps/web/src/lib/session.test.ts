import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { get } from "svelte/store";
import type { components } from "$lib/core-api.gen";

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
  test("deletes the session and clears it", async () => {
    answer = () => ({ data: ada });
    await session.signIn({ email: "ada@example.com", password: "pw" });
    calls.length = 0;
    answer = () => ({});
    await session.signOut();
    expect(calls[0]).toMatchObject({ verb: "DELETE", path: "/api/auth/session" });
    expect(get(session.useAppSession())).toEqual(signedOut);
  });

  test("clears the session even when the core cannot be reached", async () => {
    answer = () => ({ data: ada });
    await session.signIn({ email: "ada@example.com", password: "pw" });
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    await session.signOut();
    expect(get(session.useAppSession())).toEqual(signedOut);
  });
});
