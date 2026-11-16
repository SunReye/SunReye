/// <reference types="bun" />
import { expect, test } from "bun:test";
import { connect, type Transport } from "./core.ts";

const BASE = "http://core.test/prefix/";

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

test("a load asks for a radius around the plant's location and answers its status at once", async () => {
  const transport = answering(Response.json({ state: "fetching" }, { status: 202 }));

  const status = await connect(transport).loadSurroundings({ radius: 200 });

  const [request] = transport.sent;

  expect(status).toEqual({ state: "fetching" });
  expect(request?.method).toBe("POST");
  expect(request?.url).toBe(`${BASE}api/v1/surroundings`);
  expect(await request?.json()).toEqual({ radius: 200 });
});

test("a load carries a more exact centre only when one is given", async () => {
  const transport = answering(Response.json({ state: "fetching" }, { status: 202 }));

  await connect(transport).loadSurroundings({
    radius: 100,
    centre: { latitude: 48.137, longitude: 11.575 },
  });

  expect(await transport.sent[0]?.json()).toEqual({
    radius: 100,
    latitude: 48.137,
    longitude: 11.575,
  });
});

test("a refused load reports its code", async () => {
  const transport = answering(
    Response.json(
      { code: "surroundings.busy", title: "busy", status: 409 },
      { status: 409, headers: { "content-type": "application/problem+json" } },
    ),
  );

  expect(await connect(transport).loadSurroundings({ radius: 300 })).toEqual({
    problem: "surroundings.busy",
  });
});

test("the status tells the last document's digest, and a document reads by it", async () => {
  const id = "ab".repeat(32);
  const status = answering(Response.json({ state: "ready", document: id }));

  expect(await connect(status).surroundingsStatus()).toEqual({ state: "ready", document: id });
  expect(status.sent[0]?.url).toBe(`${BASE}api/v1/surroundings`);

  const document = {
    radius: 100,
    buildings: [],
    trees: [],
    hedges: [],
    grounds: [],
    terrain: { step: 5, side: 1, heights: [0] },
    credits: ["© OpenStreetMap contributors"],
  };

  const read = answering(Response.json(document));

  expect(await connect(read).surroundings(id)).toEqual(document);
  expect(read.sent[0]?.url).toBe(`${BASE}api/v1/surroundings/${id}`);
});
