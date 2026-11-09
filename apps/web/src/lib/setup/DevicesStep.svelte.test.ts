import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Device, type Transport } from "../api/core.ts";
import DevicesStep from "./DevicesStep.svelte";

const ADDED = {
  id: 6,
  connection: 5,
  name: "Wechselrichter",
  profile: "deye-sg05lp3",
  unit: 1,
};

const REPORT = {
  subnet: "192.168.1.0/24",
  endpoints: [
    {
      transport: "solarman-v5",
      host: "192.168.1.20",
      port: 8899,
      devices: [{ profile: "deye-sg05lp3", unit: 1 }],
    },
    { transport: "modbus-tcp", host: "192.168.1.30", port: 502, devices: [] },
  ],
};

/**
 * A core whose scan finds the report above; it adds the connection as 5 and the device as 6,
 * after refusing the first `refusals` device adds.
 */
function testCore(refusals = 0): Transport & { readonly calls: string[] } {
  const calls: string[] = [];
  let refuse = refusals;

  const answers: Readonly<Record<string, () => Response>> = {
    "/api/v1/scan": () => Response.json(REPORT),
    "/api/v1/connections": () => Response.json({ id: 5, secrets: [] }, { status: 201 }),
    "/api/v1/devices": () => {
      if (refuse === 0) return Response.json(ADDED, { status: 201 });

      refuse -= 1;

      return Response.json(
        { status: 422, code: "device.unreachable" },
        { status: 422, headers: { "content-type": "application/problem+json" } },
      );
    },
  };

  return {
    base: "http://core.test/",
    calls,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;

      calls.push(`${path} ${await request.text()}`);

      return answers[path]?.() ?? Response.error();
    },
  };
}

test("the admin confirms a scanned device under a name of their own", async () => {
  const transport = testCore();
  const done = vi.fn<(devices: readonly Readonly<Device>[]) => void>();
  const screen = await render(DevicesStep, { core: connect(transport), ondone: done });

  await screen.getByRole("button", { name: "Netzwerk durchsuchen" }).click();

  await expect
    .element(screen.getByText("192.168.1.30:502 antwortet, aber kein Profil erkennt das Gerät."))
    .toBeVisible();
  await screen
    .getByRole("checkbox", { name: "deye-sg05lp3 an 192.168.1.20:8899, Adresse 1" })
    .click();
  await userEvent.fill(screen.getByLabelText("Name von deye-sg05lp3"), "Wechselrichter");
  await screen.getByRole("button", { name: "Ausgewählte Geräte hinzufügen" }).click();

  await expect.poll(() => done.mock.calls.length).toBe(1);
  expect(transport.calls).toEqual([
    "/api/v1/scan {}",
    '/api/v1/connections {"name":"192.168.1.20","host":"192.168.1.20","port":8899,"transport":"solarman-v5"}',
    '/api/v1/devices {"connection":5,"name":"Wechselrichter","profile":"deye-sg05lp3","unit":1}',
  ]);
  expect(done.mock.calls[0]?.[0]).toEqual([ADDED]);
});

test("adding again after a refused device does not add its connection twice", async () => {
  const transport = testCore(1);
  const done = vi.fn<(devices: readonly Readonly<Device>[]) => void>();
  const screen = await render(DevicesStep, { core: connect(transport), ondone: done });

  await screen.getByRole("button", { name: "Netzwerk durchsuchen" }).click();
  await screen
    .getByRole("checkbox", { name: "deye-sg05lp3 an 192.168.1.20:8899, Adresse 1" })
    .click();
  await userEvent.fill(screen.getByLabelText("Name von deye-sg05lp3"), "Wechselrichter");

  const add = screen.getByRole("button", { name: "Ausgewählte Geräte hinzufügen" });

  await add.click();
  await expect.element(screen.getByRole("alert")).toBeVisible();
  await add.click();

  await expect.poll(() => done.mock.calls.length).toBe(1);
  expect(transport.calls.filter((call) => call.startsWith("/api/v1/connections"))).toHaveLength(1);
  expect(transport.calls.filter((call) => call.startsWith("/api/v1/devices"))).toEqual([
    '/api/v1/devices {"connection":5,"name":"Wechselrichter","profile":"deye-sg05lp3","unit":1}',
    '/api/v1/devices {"connection":5,"name":"Wechselrichter","profile":"deye-sg05lp3","unit":1}',
  ]);
  expect(done.mock.calls[0]?.[0]).toEqual([ADDED]);
});

test("the admin enters by hand an endpoint no profile recognises", async () => {
  const transport = testCore();
  const done = vi.fn<(devices: readonly Readonly<Device>[]) => void>();
  const screen = await render(DevicesStep, { core: connect(transport), ondone: done });

  await screen.getByRole("button", { name: "Netzwerk durchsuchen" }).click();
  await screen.getByRole("checkbox", { name: "192.168.1.30:502 von Hand hinzufügen" }).click();
  await userEvent.fill(screen.getByLabelText("Profil für 192.168.1.30:502"), "sunspec-meter");
  await userEvent.fill(screen.getByLabelText("Adresse für 192.168.1.30:502"), "3");
  await userEvent.fill(screen.getByLabelText("Name des Geräts an 192.168.1.30:502"), "Zähler");
  await screen.getByRole("button", { name: "Ausgewählte Geräte hinzufügen" }).click();

  await expect.poll(() => done.mock.calls.length).toBe(1);
  expect(transport.calls.slice(1)).toEqual([
    '/api/v1/connections {"name":"192.168.1.30","host":"192.168.1.30","port":502,"transport":"modbus-tcp"}',
    '/api/v1/devices {"connection":5,"name":"Zähler","profile":"sunspec-meter","unit":3}',
  ]);
});
