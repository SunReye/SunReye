import { afterAll, describe, expect, mock, test } from "bun:test";
import { get, writable } from "svelte/store";

// mock-hygiene-ignore-next-line -- SvelteKit virtual modules: no real module exists under bun test. The server-side values keep `$lib/auth-client` loadable.
mock.module("$app/environment", () => ({ browser: false }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));

const realAuth = await import("$lib/auth-client");
const realAuthExports = { ...realAuth };

type Raw = { data: { user: { id: string }; token?: string } | null; isPending: boolean };
const raw = writable<Raw>({ data: null, isPending: true });
mock.module("$lib/auth-client", () => ({
  ...realAuth,
  authClient: { useSession: () => raw },
}));

afterAll(() => {
  mock.module("$lib/auth-client", () => ({ ...realAuthExports }));
});

const { useAppSession } = await import("./session");

describe("useAppSession", () => {
  test("a loading session is pending with no user", () => {
    raw.set({ data: null, isPending: true });
    expect(get(useAppSession())).toEqual({ data: null, isPending: true });
  });

  test("a visitor with no session is settled and anonymous", () => {
    raw.set({ data: null, isPending: false });
    expect(get(useAppSession())).toEqual({ data: null, isPending: false });
  });

  test("a session is the user alone (no token), and never pending, even while Better Auth refetches", () => {
    raw.set({ data: { user: { id: "u1" }, token: "x" }, isPending: true });
    expect(get(useAppSession())).toEqual({
      data: { user: { id: "u1" } },
      isPending: false,
    });
  });

  test("follows the source as it changes", () => {
    raw.set({ data: null, isPending: true });
    const seen: Array<boolean> = [];
    const stop = useAppSession().subscribe((s) => seen.push(s.data !== null));
    raw.set({ data: { user: { id: "u1" } }, isPending: false });
    stop();
    expect(seen).toEqual([false, true]);
  });
});
