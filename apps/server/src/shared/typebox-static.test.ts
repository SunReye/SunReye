/**
 * Guard for a failure only the COMPILED binary shows.
 *
 * Elysia 2 `require()`s TypeBox lazily at route-compile time, so a compiled
 * binary that never wired it statically boots fine and then 500s the first
 * request to a route with a schema. Under `bun run` node_modules is right
 * there, so no in-process test can reproduce it — what a test CAN pin is that
 * the wiring exists and covers all five namespaces, which is what makes the
 * lazy require never happen. The compiled binary itself is checked by
 * scripts/compiled-binary.ts.
 */
import { describe, expect, it } from "bun:test";
import { Elysia, t } from "elysia";
import { TYPEBOX_NAMESPACES, setupStaticTypebox } from "./typebox-static";

describe("TYPEBOX_NAMESPACES", () => {
  // Elysia's own error: "All five namespaces are required together —
  // value/schema/compile alone still reaches the type leaf and crashes."
  it("carries all five namespaces Elysia asks for", () => {
    expect(Object.keys(TYPEBOX_NAMESPACES).sort()).toEqual([
      "compile",
      "schema",
      "system",
      "type",
      "value",
    ]);
  });

  it("hands over real modules, not empty namespace objects", () => {
    for (const [name, ns] of Object.entries(TYPEBOX_NAMESPACES)) {
      expect(Object.keys(ns as object).length, `${name} is empty`).toBeGreaterThan(0);
    }
  });

  // The functions the route compiler actually reaches for.
  it("exposes the value helpers the compiler uses", () => {
    expect(TYPEBOX_NAMESPACES.value).toHaveProperty("Check");
    expect(TYPEBOX_NAMESPACES.value).toHaveProperty("Decode");
    expect(TYPEBOX_NAMESPACES.value).toHaveProperty("Default");
  });
});

describe("setupStaticTypebox", () => {
  it("is idempotent, so importing it twice is harmless", () => {
    expect(() => {
      setupStaticTypebox();
      setupStaticTypebox();
    }).not.toThrow();
  });

  // Validation still has to work after the swap — a wrongly-shaped namespace
  // would leave every schema silently accepting or rejecting everything.
  it("leaves schema validation working", async () => {
    setupStaticTypebox();
    const app = new Elysia().post(
      "/x",
      { body: t.Object({ n: t.Number() }) },
      ({ body }) => body.n,
    );

    const ok = await app.handle(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n: 41 }),
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("41");

    const bad = await app.handle(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n: "not a number" }),
      }),
    );
    expect(bad.status).toBe(422);
  });
});
