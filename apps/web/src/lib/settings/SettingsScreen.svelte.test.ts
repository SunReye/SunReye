import { toast } from "svelte-sonner";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import { unfaded } from "../scroll-fade.harness.ts";
import SettingsScreen from "./SettingsScreen.svelte";
import { CAPABILITIES, CHARGE, DEVICE, problem, testCore } from "./settings.harness.ts";

afterEach(async () => {
  await page.viewport(414, 896);
});

/** Settings opened on `group`, as the admin. */
function opened(transport: Transport, group: string) {
  return render(SettingsScreen, {
    core: connect(transport),
    admin: true,
    open: group,
    onnavigate: () => null,
  });
}

test("the admin reaches every group from the root", async () => {
  const screen = await render(SettingsScreen, {
    core: connect(testCore(() => Response.json({ writes: [] }))),
    admin: true,
    open: null,
    onnavigate: () => null,
  });

  const names = [
    "Anlage",
    "Geräte",
    "Schreiben",
    "Verbindungen",
    "Tarif",
    "Prognose & Belegung",
    "Benutzer & Zugang",
    "Anzeige",
    "Über SunReye",
    "Protokolle",
    "Gefahrenzone",
  ];

  await Promise.all(
    names.map((name) =>
      expect
        .element(screen.getByRole("button", { name: new RegExp(`^${name}`, "u") }))
        .toBeVisible(),
    ),
  );
  expect(unfaded()).toEqual([]);
});

test("a viewer sees only the display, which is the browser's own, and About", async () => {
  const screen = await render(SettingsScreen, {
    core: connect(testCore(() => Response.json({ writes: [] }))),
    admin: false,
    open: null,
    onnavigate: () => null,
  });

  await expect
    .element(screen.getByRole("button", { name: /^Anzeige\s*Dunkel · Deutsch/u }))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: /^Über SunReye/u })).toBeVisible();
  expect(screen.getByRole("button", { name: /^Anlage/u }).query()).toBeNull();
  expect(screen.getByRole("button", { name: /^Benutzer & Zugang/u }).query()).toBeNull();
});

test("without the admin's session the write log is not shown", async () => {
  const screen = await opened(
    testCore(() => problem(401, "auth.required")),
    "logs",
  );

  await expect.element(screen.getByRole("heading", { name: "Protokolle" })).toBeVisible();
  expect(screen.getByRole("list", { name: "Schreibprotokoll" }).query()).toBeNull();
  expect(screen.getByText("Noch nichts geschrieben").query()).toBeNull();
});

test("a device whose writes are off says so and is switched on in one click", async () => {
  const off = structuredClone(CAPABILITIES);
  off.devices["3"].writes = false;

  const sent: string[] = [];

  const transport: Transport = {
    base: "http://core.test/",
    fetch: async (request) => {
      if (request.url.endsWith("/capabilities")) return Response.json(off);

      if (request.method === "PUT") {
        sent.push(await request.text());

        return Response.json(DEVICE);
      }

      return Response.json({ devices: [{ ...DEVICE, writes: false }] });
    },
  };

  const screen = await opened(transport, "writes");
  const writes = screen.getByRole("switch", { name: "Schreiben erlaubt: Wechselrichter" });

  await expect.element(writes).not.toBeChecked();
  await expect
    .element(screen.getByText("Aus: Kein Wert wird an dieses Gerät geschrieben."))
    .toBeVisible();

  await userEvent.click(writes);

  const { id, ...draft } = DEVICE;

  expect(id).toBe(3);
  expect(sent).toEqual([JSON.stringify({ ...draft, writes: true })]);
});

test("a setting that needs the admin's enable shows its bounds and is enabled in one click", async () => {
  const off = structuredClone(CAPABILITIES);
  const charge = off.devices["3"].settings[0];

  if (charge) charge.enable = "off";

  let capabilities = off;

  const transport = testCore(
    () => Response.json({ writes: [] }),
    () => {
      capabilities = CAPABILITIES;

      return new Response(null, { status: 204 });
    },
    { "/api/v1/capabilities": () => Response.json(capabilities) },
  );

  const screen = await opened(transport, "writes");

  // The note is said once for the device, not on each row.
  await expect
    .element(screen.getByText("Nicht auf Hardware geprüft: wird erst nach Freigabe geschrieben."))
    .toBeVisible();
  await expect.element(screen.getByText("0 bis 350, Schritt 1")).toBeVisible();

  const enable = screen.getByRole("switch", { name: "Max. Ladestrom freigeben" });

  await expect.element(enable).not.toBeChecked();
  await userEvent.click(enable);

  expect(transport.writes).toEqual([`PUT /api/v1/devices/3/settings/${CHARGE}/enabled `]);
  await expect.element(enable).toBeChecked();
});

test("an update shows what it changes and is applied in one click", async () => {
  const update = {
    id: "box",
    from: "1.0.0",
    to: "1.1.0",
    settings: [
      {
        key: CHARGE,
        change: "changed",
        before: { range: { min: 0, max: 350 }, step: 1 },
        after: { range: { min: 0, max: 400 }, step: 1 },
      },
      { key: "work_mode", change: "removed", before: { values: [0, 1, 2], step: 1 }, after: null },
    ],
    quantities: [{ key: "battery.power", change: "added" }],
  };

  let updates = [update];

  const transport = testCore(
    () => Response.json({ writes: [] }),
    () => {
      updates = [];

      return Response.json(update);
    },
    { "/api/v1/profile-updates": () => Response.json({ updates }) },
  );

  const screen = await opened(transport, "devices");

  const diff = screen.getByRole("list", { name: "box: 1.0.0 → 1.1.0" });
  const items = diff.getByRole("listitem");

  await expect.element(diff).toBeVisible();
  await expect
    .element(items.nth(0))
    .toHaveTextContent("Max. Ladestrom geändert · 0 bis 350, Schritt 1 → 0 bis 400, Schritt 1");
  await expect.element(items.nth(1)).toHaveTextContent("Betriebsart entfernt · Werte 0, 1, 2 → –");
  await expect.element(items.nth(2)).toHaveTextContent("Battery power hinzugefügt");

  await userEvent.click(screen.getByRole("button", { name: "Update für box anwenden" }));

  expect(transport.writes).toEqual(["POST /api/v1/profile-updates/box "]);
  await expect.element(diff).not.toBeInTheDocument();
});

test("a setting awaiting its enable lists its values by their labels", async () => {
  const screen = await opened(
    testCore(() => Response.json({ writes: [] })),
    "writes",
  );

  await expect
    .element(screen.getByText("Werte off, now, minpv, pv", { exact: true }))
    .toBeVisible();
});

test("the devices page lists each device with its profile", async () => {
  const screen = await opened(
    testCore(() => Response.json({ writes: [] })),
    "devices",
  );

  await expect.element(screen.getByText("Wechselrichter")).toBeVisible();
  await expect.element(screen.getByText("hybrid-test")).toBeVisible();
});

test("the plant page shows the plant's timezone and location and saves them", async () => {
  const transport = testCore(
    () => Response.json({ writes: [] }),
    () => Response.json({ latitude: 48.1, longitude: 11.6 }),
    {
      "/api/v1/timezone": () => Response.json({ name: "Europe/Vienna" }),
      "/api/v1/location": () => Response.json({ latitude: 48.1, longitude: 11.6 }),
    },
  );

  const screen = await opened(transport, "plant");

  await expect
    .element(screen.getByRole("combobox", { name: "Zeitzone der Anlage" }))
    .toHaveTextContent("Europe/Vienna");
  await expect.element(screen.getByRole("textbox", { name: "Breitengrad" })).toHaveValue("48.1");

  const success = vi.spyOn(toast, "success");

  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  await expect.poll(() => success.mock.calls.at(-1)?.[0]).toBe("Gespeichert.");
  expect(screen.getByRole("status").query()).toBeNull();
  expect(transport.writes).toEqual([
    'PUT /api/v1/timezone {"name":"Europe/Vienna"}',
    'PUT /api/v1/location {"latitude":48.1,"longitude":11.6}',
  ]);
});

test("the connections page lists each connection and a broker's state", async () => {
  const screen = await opened(
    testCore(() => Response.json({ writes: [] }), undefined, {
      "/api/v1/connections": () =>
        Response.json({
          connections: [
            {
              id: 1,
              name: "Stick",
              transport: "modbus-tcp",
              host: "10.0.0.5",
              port: 8899,
              secrets: [],
            },
            {
              id: 2,
              name: "Broker",
              transport: "mqtt",
              host: "broker.lan",
              port: 1883,
              topicRoot: "evcc",
              secrets: [],
              status: { connected: true },
            },
          ],
        }),
    }),
    "connections",
  );

  await expect.element(screen.getByText(/^modbus-tcp · 10\.0\.0\.5:8899$/u)).toBeVisible();
  await expect.element(screen.getByText(/^mqtt · broker\.lan:1883$/u)).toBeVisible();
  // The state has a line of its own, so a long error never pushes the address off.
  await expect.element(screen.getByText("Broker: verbunden", { exact: true })).toBeVisible();
});

test("the forecast page leads to the builder", async () => {
  const screen = await opened(
    testCore(() => Response.json({ writes: [] })),
    "forecast",
  );

  await expect
    .element(screen.getByRole("link", { name: /^3D-Haus und PV-Module bearbeiten/u }))
    .toHaveAttribute("href", "#/builder");
});
