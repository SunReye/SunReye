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

/** A browser that shares where it is, or refuses to. */
function located(shared: boolean): void {
  vi.spyOn(navigator.geolocation, "getCurrentPosition").mockImplementation((found, failed) => {
    if (shared) {
      const coords = {
        latitude: 52.520_008,
        longitude: 13.404_954,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      };

      found({ coords, timestamp: 0, toJSON: () => ({}) });
    } else
      failed?.({
        code: 1,
        message: "denied",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      });
  });
}

test("the browser's own location fills the coordinates, rounded to about ten metres", async () => {
  located(true);

  const transport = testCore();
  const screen = await render(PlantStep, { core: connect(transport), ondone: () => {} });

  await screen.getByRole("button", { name: "Aktuellen Standort verwenden" }).click();

  await expect.element(screen.getByLabelText("Breitengrad")).toHaveValue(52.52);
  await expect.element(screen.getByLabelText("Längengrad")).toHaveValue(13.405);
  vi.restoreAllMocks();
});

test("a browser that keeps its location says so, and the coordinates stay to type", async () => {
  located(false);

  const screen = await render(PlantStep, { core: connect(testCore()), ondone: () => {} });

  await screen.getByRole("button", { name: "Aktuellen Standort verwenden" }).click();

  await expect
    .element(screen.getByRole("alert").getByText(/gibt den Standort nicht frei/u))
    .toBeVisible();
  vi.restoreAllMocks();
});
