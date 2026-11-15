import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Device, type Transport } from "../api/core.ts";
import "../../app.css";
import { tap } from "../builder/pointer.harness.ts";
import DevicesStep from "./DevicesStep.svelte";

/** A phone; the value editor lands at once. */
beforeEach(async () => {
  await page.viewport(390, 800);
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
});

afterEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

/** Types `value` into a number row's value editor and applies it. */
async function enter(row: string, value: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${row} `, "u") }).click();
  await page.getByRole("button", { name: /tippen zum Eingeben/u }).click();
  await userEvent.fill(page.getByRole("textbox", { name: `${row} eingeben` }), value);
  await userEvent.keyboard("{Enter}");
  await page.getByRole("button", { name: /^Übernehmen/u }).click();
}

const ADDED = {
  id: 6,
  connection: 5,
  name: "Wechselrichter",
  profile: "deye-sg05lp3",
  variant: "15k",
  unit: 1,
};

/** A profile the test core serves. */
const served = (
  id: string,
  manufacturer: string,
  name: string,
  variants: readonly string[] = [],
) => ({
  id,
  manufacturer,
  name,
  version: "1.0.0",
  official: true,
  acRating: variants.length > 0 ? 20_000 : null,
  variants: variants.map((kw) => ({
    id: `${kw}k`,
    name: `SUN-${kw}K-SG05LP3-EU-SM2`,
    acRating: Number(kw) * 1000,
  })),
});

const PROFILES = [
  served("deye-sg05lp3", "Deye", "SG05LP3", ["5", "15"]),
  served("shelly-pro-3em", "Shelly", "Pro 3EM"),
  served("sunspec", "SunSpec", "SunSpec device"),
];

/** Picks the profile named `name` for the device at `at` from the catalogue, by searching for `search`. */
async function pick(at: string, search: string, name: string): Promise<void> {
  await page.getByRole("button", { name: `Profil für ${at}` }).click();
  await userEvent.fill(page.getByRole("searchbox", { name: "Profil suchen" }), search);
  await page.getByRole("button", { name: new RegExp(`^${name}`, "u") }).click();
}

const REPORT = {
  subnet: "192.168.1.0/24",
  endpoints: [
    {
      transport: "solarman-v5",
      host: "192.168.1.20",
      port: 8899,
      devices: [
        { profile: "deye-sg05lp3", variant: "15k", name: "SUN-15K-SG05LP3-EU-SM2", unit: 1 },
      ],
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

  const answers = new Map<string, () => Response>([
    ["/api/v1/scan", () => Response.json(REPORT)],
    ["/api/v1/profiles", () => Response.json({ profiles: PROFILES })],
    ["/api/v1/connections", () => Response.json({ id: 5, secrets: [] }, { status: 201 })],
    [
      "/api/v1/devices",
      () => {
        if (refuse === 0) return Response.json(ADDED, { status: 201 });

        refuse -= 1;

        return Response.json(
          { status: 422, code: "device.unreachable" },
          { status: 422, headers: { "content-type": "application/problem+json" } },
        );
      },
    ],
  ]);

  return {
    base: "http://core.test/",
    calls,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;

      if (request.method !== "GET") calls.push(`${path} ${await request.text()}`);

      return answers.get(path)?.() ?? Response.error();
    },
  };
}

test("the admin confirms a scanned device under a name of their own", async () => {
  const transport = testCore();
  const done = vi.fn<(devices: readonly Readonly<Device>[]) => void>();
  const screen = await render(DevicesStep, { core: connect(transport), ondone: done });

  await screen.getByRole("button", { name: "Netzwerk durchsuchen" }).click();

  await expect
    .element(
      screen.getByRole("checkbox", {
        name: "SUN-15K-SG05LP3-EU-SM2 an 192.168.1.20:8899, Adresse 1",
      }),
    )
    .toBeChecked();
  await userEvent.fill(screen.getByLabelText("Name von SUN-15K-SG05LP3-EU-SM2"), "Wechselrichter");
  await screen.getByRole("button", { name: "Ausgewählte Geräte hinzufügen" }).click();

  await expect.poll(() => done.mock.calls.length).toBe(1);
  expect(transport.calls).toEqual([
    "/api/v1/scan {}",
    '/api/v1/connections {"name":"192.168.1.20","host":"192.168.1.20","port":8899,"transport":"solarman-v5"}',
    '/api/v1/devices {"connection":5,"name":"Wechselrichter","profile":"deye-sg05lp3","variant":"15k","unit":1}',
  ]);
  expect(done.mock.calls[0]?.[0]).toEqual([ADDED]);
});

test("adding again after a refused device does not add its connection twice", async () => {
  const transport = testCore(1);
  const done = vi.fn<(devices: readonly Readonly<Device>[]) => void>();
  const screen = await render(DevicesStep, { core: connect(transport), ondone: done });

  await screen.getByRole("button", { name: "Netzwerk durchsuchen" }).click();
  await userEvent.fill(screen.getByLabelText("Name von SUN-15K-SG05LP3-EU-SM2"), "Wechselrichter");

  const add = screen.getByRole("button", { name: "Ausgewählte Geräte hinzufügen" });

  await add.click();
  await expect.element(screen.getByRole("alert")).toBeVisible();
  await add.click();

  await expect.poll(() => done.mock.calls.length).toBe(1);
  expect(transport.calls.filter((call) => call.startsWith("/api/v1/connections"))).toHaveLength(1);
  expect(transport.calls.filter((call) => call.startsWith("/api/v1/devices"))).toEqual([
    '/api/v1/devices {"connection":5,"name":"Wechselrichter","profile":"deye-sg05lp3","variant":"15k","unit":1}',
    '/api/v1/devices {"connection":5,"name":"Wechselrichter","profile":"deye-sg05lp3","variant":"15k","unit":1}',
  ]);
  expect(done.mock.calls[0]?.[0]).toEqual([ADDED]);
});

test("the admin enters by hand an endpoint no profile recognises", async () => {
  const transport = testCore();
  const done = vi.fn<(devices: readonly Readonly<Device>[]) => void>();
  const screen = await render(DevicesStep, { core: connect(transport), ondone: done });

  await screen.getByRole("button", { name: "Netzwerk durchsuchen" }).click();
  await screen
    .getByRole("checkbox", { name: "SUN-15K-SG05LP3-EU-SM2 an 192.168.1.20:8899, Adresse 1" })
    .click();
  await screen.getByRole("button", { name: /^Weitere Geräte im Netzwerk/u }).click();
  await screen.getByRole("button", { name: "192.168.1.30:502 von Hand hinzufügen" }).click();
  await pick("192.168.1.30:502", "sunspec", "SunSpec device");
  await enter("Adresse für 192.168.1.30:502", "3");
  await userEvent.fill(screen.getByLabelText("Name des Geräts an 192.168.1.30:502"), "Zähler");
  await screen.getByRole("button", { name: "Ausgewählte Geräte hinzufügen" }).click();

  await expect.poll(() => done.mock.calls.length).toBe(1);
  expect(transport.calls.slice(1)).toEqual([
    '/api/v1/connections {"name":"192.168.1.30","host":"192.168.1.30","port":502,"transport":"modbus-tcp"}',
    '/api/v1/devices {"connection":5,"name":"Zähler","profile":"sunspec","unit":3}',
  ]);
});

/** Enters the RTU gateway at 192.168.1.40:4196 by hand, up to choosing its device's profile. */
async function gateway(): Promise<void> {
  await tap(page.getByRole("button", { name: "Endpunkt von Hand eingeben" }));
  await userEvent.fill(page.getByLabelText("Host"), "192.168.1.40");
  await enter("Port", "4196");
  await tap(page.getByRole("radio", { name: "rtu-over-tcp" }));
  await tap(page.getByRole("button", { name: "Endpunkt hinzufügen" }));
}

test("a device entered by hand is added as the variant of its family the admin picks", async () => {
  const transport = testCore();
  const done = vi.fn<(devices: readonly Readonly<Device>[]) => void>();
  const profile = page.getByRole("button", { name: "Profil für 192.168.1.40:4196" });

  await render(DevicesStep, { core: connect(transport), ondone: done });

  await gateway();
  await pick("192.168.1.40:4196", "sg05", "SUN-5K-SG05LP3-EU-SM2");
  await expect.element(profile).toHaveTextContent("SUN-5K-SG05LP3-EU-SM2 5 kW");
  await userEvent.fill(page.getByLabelText("Name des Geräts an 192.168.1.40:4196"), "Keller");
  await tap(page.getByRole("button", { name: "Ausgewählte Geräte hinzufügen" }));

  await expect.poll(() => done.mock.calls.length).toBe(1);
  expect(transport.calls[1]).toBe(
    '/api/v1/devices {"connection":5,"name":"Keller","profile":"deye-sg05lp3","variant":"5k","unit":1}',
  );
});

test("the admin enters an RTU gateway the scan does not probe by hand", async () => {
  const transport = testCore();
  const done = vi.fn<(devices: readonly Readonly<Device>[]) => void>();
  const screen = await render(DevicesStep, { core: connect(transport), ondone: done });

  await gateway();
  // Another profile drops the variant picked before it.
  await pick("192.168.1.40:4196", "sg05", "SUN-5K-SG05LP3-EU-SM2");
  await pick("192.168.1.40:4196", "3em", "Pro 3EM");
  await enter("Adresse für 192.168.1.40:4196", "2");
  await userEvent.fill(screen.getByLabelText("Name des Geräts an 192.168.1.40:4196"), "Zähler");
  await screen.getByRole("button", { name: "Ausgewählte Geräte hinzufügen" }).click();

  await expect.poll(() => done.mock.calls.length).toBe(1);
  expect(transport.calls).toEqual([
    '/api/v1/connections {"name":"192.168.1.40","host":"192.168.1.40","port":4196,"transport":"rtu-over-tcp"}',
    '/api/v1/devices {"connection":5,"name":"Zähler","profile":"shelly-pro-3em","unit":2}',
  ]);
});

test("hosts no profile recognises wait folded away under their own row", async () => {
  const screen = await render(DevicesStep, { core: connect(testCore()), ondone: () => {} });

  await screen.getByRole("button", { name: "Netzwerk durchsuchen" }).click();

  const more = screen.getByRole("button", { name: /^Weitere Geräte im Netzwerk/u });

  await expect.element(more).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("192.168.1.30:502").query()).toBeNull();
  await more.click();
  await expect.element(screen.getByText("192.168.1.30:502")).toBeVisible();
});

test("a scan that finds nothing says so and offers the endpoint by hand", async () => {
  const transport: Transport = {
    base: "http://core.test/",
    fetch: () => Promise.resolve(Response.json({ subnet: "192.168.1.0/24", endpoints: [] })),
  };

  const screen = await render(DevicesStep, { core: connect(transport), ondone: () => {} });

  await screen.getByRole("button", { name: "Netzwerk durchsuchen" }).click();

  await expect.element(screen.getByText("Kein Gerät gefunden.")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Endpunkt von Hand eingeben" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Ausgewählte Geräte hinzufügen/u }))
    .toBeDisabled();
});

test("a running scan shows its progress", async () => {
  const report = Promise.withResolvers<Response>();

  const transport: Transport = { base: "http://core.test/", fetch: () => report.promise };

  const screen = await render(DevicesStep, { core: connect(transport), ondone: () => {} });

  await screen.getByRole("button", { name: "Netzwerk durchsuchen" }).click();

  await expect
    .element(screen.getByRole("status").getByText(/Netzwerk wird durchsucht/u))
    .toBeVisible();
  report.resolve(Response.json(REPORT));
  await expect
    .element(
      screen.getByRole("checkbox", {
        name: "SUN-15K-SG05LP3-EU-SM2 an 192.168.1.20:8899, Adresse 1",
      }),
    )
    .toBeChecked();
});
