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

const TODAY = { id: 3, name: "Heute", query: "r=day&s=pv.power" };

test("saved views list in the order saved, and a refusal reports its code", async () => {
  const listed = answering(Response.json({ views: [TODAY, { id: 5, name: "Woche", query: "" }] }));

  expect(await connect(listed).views()).toEqual([TODAY, { id: 5, name: "Woche", query: "" }]);
  expect(listed.sent[0]?.url).toBe(`${BASE}api/v1/views`);
  expect(await connect(answering(problem(401, "auth.required"))).views()).toEqual({
    problem: "auth.required",
  });
});

test("a view is saved with its name and query, and a taken name or a full list is refused", async () => {
  const core = answering(Response.json(TODAY, { status: 201 }));

  expect(await connect(core).saveView("Heute", "r=day&s=pv.power")).toEqual(TODAY);
  expect(core.sent[0]?.method).toBe("POST");
  expect(core.sent[0]?.url).toBe(`${BASE}api/v1/views`);
  expect(await core.sent[0]?.json()).toEqual({ name: "Heute", query: "r=day&s=pv.power" });
  expect(await connect(answering(problem(409, "views.name"))).saveView("Heute", "")).toEqual({
    problem: "views.name",
  });
  expect(await connect(answering(problem(409, "views.full"))).saveView("Heute", "")).toEqual({
    problem: "views.full",
  });
});

test("a view is replaced by id with its name and query", async () => {
  const core = answering(Response.json(TODAY));

  expect(await connect(core).replaceView(3, "Heute", "r=day&s=pv.power")).toEqual(TODAY);
  expect(core.sent[0]?.method).toBe("PUT");
  expect(core.sent[0]?.url).toBe(`${BASE}api/v1/views/3`);
  expect(await core.sent[0]?.json()).toEqual({ name: "Heute", query: "r=day&s=pv.power" });
});

test("a view is removed by id", async () => {
  const core = answering(new Response(null, { status: 204 }));

  expect(await connect(core).removeView(3)).toBeUndefined();
  expect(core.sent[0]?.method).toBe("DELETE");
  expect(core.sent[0]?.url).toBe(`${BASE}api/v1/views/3`);
  expect(await connect(answering(problem(404, "views.none"))).removeView(3)).toEqual({
    problem: "views.none",
  });
});
