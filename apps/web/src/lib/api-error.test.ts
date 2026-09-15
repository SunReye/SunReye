import { describe, expect, it } from "bun:test";

import { apiErrorText, apiMessageText } from "./api-error";

describe("apiErrorText", () => {
  it("reads the `error` field every failing route answers with", () => {
    // `status(400, { error, field })` — the shape settings.ts, devices.ts and
    // every other admin write refuse with.
    expect(apiErrorText({ error: "Timed out", field: null }, "fallback")).toBe("Timed out");
  });

  it("passes a plain-text body through", () => {
    expect(apiErrorText("Not authorized", "fallback")).toBe("Not authorized");
  });

  it("reads Elysia's own validation summary", () => {
    expect(
      apiErrorText({ type: "validation", on: "body", summary: "Expected number" }, "fallback"),
    ).toBe("Expected number");
  });

  it("reads a serialised Error, which is what better-auth sends", () => {
    expect(apiErrorText({ message: "socket hang up" }, "fallback")).toBe("socket hang up");
  });

  it("falls back when the request itself never produced a body", () => {
    expect(apiErrorText(null, "request failed")).toBe("request failed");
    expect(apiErrorText(undefined, "request failed")).toBe("request failed");
    expect(apiErrorText("", "request failed")).toBe("request failed");
  });

  it('serialises a body that names itself in no other way, never "[object Object]"', () => {
    expect(apiErrorText({ code: 500 }, "fallback")).toBe('{"code":500}');
  });

  it("falls back for a body that cannot be serialised", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(apiErrorText(cyclic, "request failed")).toBe("request failed");
  });
});

describe("apiMessageText", () => {
  it("reads better-auth's `message`, and nothing else", () => {
    expect(apiMessageText({ message: "Invalid password" }, "fallback")).toBe("Invalid password");
    expect(apiMessageText({ error: "Invalid password" }, "fallback")).toBe("fallback");
  });
});
