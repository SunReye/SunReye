import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import TopologyStep from "./TopologyStep.svelte";

const INVERTER = { id: 1, name: "Wechselrichter", profile: "p", connection: 1, unit: 1 };

/** The live snapshot, then a stream held open. */
function live(): Response {
  const snapshot = '{"devices":{"1":{"grid.power":-300,"pv.power":1200,"battery.power":0}}}';

  return new Response(
    new ReadableStream({
      start: (controller) => {
        controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${snapshot}\n\n`));
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

/** A core reading the inverter above; it keeps each topology change. */
function testCore(): Transport & { readonly changes: string[] } {
  const changes: string[] = [];

  return {
    base: "http://core.test/",
    changes,
    fetch: async (request) => {
      if (new URL(request.url).pathname === "/api/v1/live") return live();

      changes.push(await request.text());

      return Response.json({ appliesFrom: "2026-11-09T00:00:00Z", points: [] });
    },
  };
}

test("the proposed tree is adjusted and saved from now on", async () => {
  const transport = testCore();
  const done = vi.fn<() => void>();

  const screen = await render(TopologyStep, {
    core: connect(transport),
    devices: [INVERTER],
    ondone: done,
  });

  await expect
    .element(screen.getByLabelText("Name von Punkt 3"))
    .toHaveValue("Wechselrichter Batterie");
  await userEvent.fill(screen.getByLabelText("Name von Punkt 2"), "Dach");
  await screen.getByRole("button", { name: "Punkt 3 entfernen" }).click();
  await screen.getByRole("button", { name: "Messpunkte speichern" }).click();

  await expect.poll(() => done.mock.calls.length).toBe(1);
  expect(transport.changes).toHaveLength(1);

  const change: unknown = JSON.parse(transport.changes[0] ?? "");

  expect(change).toMatchObject({
    points: [
      { name: "Netzanschluss", parent: null, claims: [{ device: 1, role: "grid.power" }] },
      { name: "Dach", parent: 0, claims: [{ device: 1, role: "pv.power" }] },
    ],
  });
});
