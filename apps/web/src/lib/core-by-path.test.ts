import { describe, expect, mock, test } from "bun:test";

// mock-hygiene-ignore-next-line -- SvelteKit virtual modules: no real module exists under bun test. They keep `$lib/core-api` loadable.
mock.module("$app/environment", () => ({ browser: false }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$app/navigation", () => ({ goto: async () => {} }));
// mock-hygiene-ignore-next-line -- SvelteKit virtual module, see above.
mock.module("$env/dynamic/public", () => ({ env: {} }));

const { refused } = await import("./core-by-path");

describe("refused", () => {
  test("an answer with an error body is refused, whatever the body", () => {
    expect(refused({ error: { error: "no" } })).toBe(true);
    // openapi-fetch reads an empty error body as "": falsy, still a refusal.
    expect(refused({ error: "" })).toBe(true);
    expect(refused({ error: null })).toBe(true);
  });

  test("a non-2xx response is refused even with no error body", () => {
    expect(refused({ response: { ok: false } as Response })).toBe(true);
  });

  test("a 2xx answer, or one with nothing to read, is not", () => {
    expect(refused({ response: { ok: true } as Response })).toBe(false);
    expect(refused({})).toBe(false);
  });
});
