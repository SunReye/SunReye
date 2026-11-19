/// <reference types="bun" />
import { expect, test } from "bun:test";
import { connect, type Transport } from "./core.ts";
import { BASE } from "./core.harness.ts";

/** A core that answers every request with `response` and keeps what it was sent. */
function answering(response: Response): Transport & { readonly sent: Request[] } {
  const sent: Request[] = [];

  return {
    base: BASE,
    sent,
    fetch: (request) => {
      sent.push(request);

      return Promise.resolve(response);
    },
  };
}

const DOCUMENT = { openapi: "3.1.0", info: { title: "SunReye", version: "1" }, paths: {} };

test("the API reference reads the core's document under its prefix, and names that prefix its server", async () => {
  const core = answering(Response.json(DOCUMENT));

  expect(await connect(core).reference()).toEqual({
    ...DOCUMENT,
    servers: [{ url: "http://core.test/prefix" }],
  });
  expect(core.sent[0]?.url).toBe(`${BASE}openapi.json`);
});

test("a document the core cannot give is refused with its status", async () => {
  const core = answering(new Response("bad gateway", { status: 502 }));

  expect(await connect(core).reference()).toEqual({ problem: "http.502" });
});
