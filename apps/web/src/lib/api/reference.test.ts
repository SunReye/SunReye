/// <reference types="bun" />
import { expect, test } from "bun:test";
import { connect } from "./core.ts";
import { answering, API_DOCUMENT, BASE } from "./core.harness.ts";

test("the API reference reads the core's document under its prefix, and names that prefix its server", async () => {
  const core = answering(Response.json(API_DOCUMENT));

  expect(await connect(core).reference()).toEqual({
    ...API_DOCUMENT,
    servers: [{ url: "http://core.test/prefix" }],
  });
  expect(core.sent[0]?.url).toBe(`${BASE}openapi.json`);
});

test("a document the core cannot give is refused with its status", async () => {
  const core = answering(new Response("bad gateway", { status: 502 }));

  expect(await connect(core).reference()).toEqual({ problem: "http.502" });
});
