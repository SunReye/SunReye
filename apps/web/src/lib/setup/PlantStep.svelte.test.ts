import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import PlantStep from "./PlantStep.svelte";

function problem(status: number, code: string): Response {
  return Response.json(
    { status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/** A core that keeps each write; a location off the globe is refused. */
function testCore(): Transport & { readonly calls: string[] } {
  const calls: string[] = [];

  return {
    base: "http://core.test/",
    calls,
    fetch: async (request) => {
      const body = await request.text();

      calls.push(`${request.method} ${new URL(request.url).pathname} ${body}`);

      return body.includes('"latitude":152.5')
        ? problem(422, "location.value")
        : new Response(body, { headers: { "content-type": "application/json" } });
    },
  };
}

test("the plant timezone and location are set, a location off the globe is refused", async () => {
  const transport = testCore();
  const done = vi.fn<() => void>();
  const screen = await render(PlantStep, { core: connect(transport), ondone: done });

  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Zeitzone der Anlage" }).element(),
    "Europe/Berlin",
  );
  await userEvent.fill(screen.getByLabelText("Breitengrad"), "152.5");
  await userEvent.fill(screen.getByLabelText("Längengrad"), "13.38");
  await screen.getByRole("button", { name: "Weiter" }).click();

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(
      "Der Breitengrad muss zwischen -90 und 90 liegen, der Längengrad zwischen -180 und 180.",
    );
  expect(done).not.toHaveBeenCalled();

  await userEvent.fill(screen.getByLabelText("Breitengrad"), "52.52");
  await screen.getByRole("button", { name: "Weiter" }).click();

  await expect.poll(() => done.mock.calls.length).toBe(1);
  expect(transport.calls.slice(-2)).toEqual([
    'PUT /api/v1/timezone {"name":"Europe/Berlin"}',
    'PUT /api/v1/location {"latitude":52.52,"longitude":13.38}',
  ]);
});
