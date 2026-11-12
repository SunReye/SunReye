/// <reference types="bun" />
import { expect, test } from "bun:test";
import { connect, type Transport } from "./core.ts";
import { BASE, problem } from "./core.harness.ts";

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

test("viewers list by name, and a refusal reports its code", async () => {
  const listed = answering(Response.json({ viewers: [{ id: 2, name: "Oma" }] }));
  const refused = answering(problem(403, "auth.forbidden"));

  expect(await connect(listed).viewers()).toEqual([{ id: 2, name: "Oma" }]);
  expect(listed.sent[0]?.url).toBe(`${BASE}api/v1/viewers`);
  expect(await connect(refused).viewers()).toEqual({ problem: "auth.forbidden" });
});

test("a viewer is added with its name and password, and answers without the password", async () => {
  const core = answering(Response.json({ id: 4, name: "Oma" }, { status: 201 }));

  const added = await connect(core).addViewer("Oma", "geheim123");

  expect(added).toEqual({ id: 4, name: "Oma" });
  expect(core.sent[0]?.method).toBe("POST");
  expect(await core.sent[0]?.json()).toEqual({ name: "Oma", password: "geheim123" });
});

test("a taken name is refused with its code", async () => {
  const core = answering(problem(409, "viewer.name"));

  expect(await connect(core).addViewer("Oma", "geheim123")).toEqual({ problem: "viewer.name" });
});

test("a viewer is removed by id", async () => {
  const core = answering(new Response(null, { status: 204 }));

  expect(await connect(core).removeViewer(4)).toBeUndefined();
  expect(core.sent[0]?.method).toBe("DELETE");
  expect(core.sent[0]?.url).toBe(`${BASE}api/v1/viewers/4`);
  expect(await connect(answering(problem(404, "viewer.none"))).removeViewer(4)).toEqual({
    problem: "viewer.none",
  });
});

test("tokens list with their scope, never the token", async () => {
  const core = answering(Response.json({ tokens: [{ id: 1, name: "evcc", scope: "read" }] }));

  expect(await connect(core).tokens()).toEqual([{ id: 1, name: "evcc", scope: "read" }]);
  expect(core.sent[0]?.url).toBe(`${BASE}api/v1/tokens`);
});

test("a created token answers the token once, with its name and scope", async () => {
  const created = { id: 3, name: "evcc", scope: "admin", token: "a".repeat(64) };
  const core = answering(Response.json(created, { status: 201 }));

  expect(await connect(core).addToken("evcc", "admin")).toEqual(created);
  expect(core.sent[0]?.method).toBe("POST");
  expect(await core.sent[0]?.json()).toEqual({ name: "evcc", scope: "admin" });
});

test("a token is revoked by id", async () => {
  const core = answering(new Response(null, { status: 204 }));

  expect(await connect(core).removeToken(3)).toBeUndefined();
  expect(core.sent[0]?.method).toBe("DELETE");
  expect(core.sent[0]?.url).toBe(`${BASE}api/v1/tokens/3`);
});
