// Every settings level on a narrow phone: nothing wider than the screen, no control the browser
// draws, and no setting's key where its name belongs.
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import { FakeCore } from "./devices.harness.ts";
import SettingsScreen from "./SettingsScreen.svelte";
import { attempt, CAPABILITIES, CHARGE } from "./settings.harness.ts";

afterEach(async () => {
  await page.viewport(414, 896);
});

const LONG = "Wärmepumpen-Hausanschluss-Messstelle-Nebengebäude";

/** CAPABILITIES' settings, by key. */
const KEYS = [CHARGE, "work_mode", "ev.mode"];

const TARIFF = {
  appliesFrom: "2026-11-01T00:00:00Z",
  import: {
    price: 0.3,
    bands: [{ days: [1, 2, 3, 4, 5], from: "22:00", to: "24:00", price: 0.2 }],
  },
  export: { price: 0.08, bands: [] },
};

/** A profile update touching every setting, so the devices page lists them. */
const UPDATE = {
  id: "box",
  from: "1.0.0",
  to: "1.1.0",
  settings: KEYS.map((key) => ({
    key,
    change: "added",
    before: null,
    after: { range: { min: 0, max: 100 }, step: 1 },
  })),
  quantities: [],
};

/** A plant with something on every page, names long enough to wrap or cut. */
function plant(): Transport {
  const devices = new FakeCore();

  devices.connections.push({
    id: 2,
    name: "HA-MQTT",
    transport: "mqtt",
    host: "homeassistant.very-long-domain.example.lan",
    port: 1883,
    secrets: ["username"],
    status: { connected: false, lastError: "connection refused by the broker after 3 tries" },
  });
  devices.devices.push({ id: 4, connection: 2, name: LONG, profile: "evcc", unit: 1 });

  const reads = new Map([
    ["/api/v1/capabilities", () => Response.json(CAPABILITIES)],
    [
      "/api/v1/writes",
      () => Response.json({ writes: KEYS.map((setting) => attempt({ setting })) }),
    ],
    ["/api/v1/profile-updates", () => Response.json({ updates: [UPDATE] })],
    ["/api/v1/timezone", () => Response.json({ name: "America/Argentina/ComodRivadavia" })],
    ["/api/v1/location", () => Response.json({ latitude: 48.1, longitude: 11.6 })],
    ["/api/v1/tariff", () => Response.json(TARIFF)],
    ["/api/v1/spot-prices", () => Response.json({ zone: "DE-LU" })],
    [
      "/api/v1/payback",
      () => Response.json({ investment: 12_000, savings: 312.5, remaining: 11_687.5 }),
    ],
    ["/api/v1/viewers", () => Response.json({ viewers: [{ id: 1, name: LONG }] })],
    ["/api/v1/tokens", () => Response.json({ tokens: [{ id: 1, name: "evcc", scope: "read" }] })],
    ["/api/v1/import", () => Response.json({ state: "idle", done: 0, total: 0 })],
    ["/api/v1/import/files", () => Response.json({ files: [] })],
  ]);

  return {
    base: devices.base,
    fetch: (request) => {
      const read = request.method === "GET" ? reads.get(new URL(request.url).pathname) : undefined;

      return read ? Promise.resolve(read()) : devices.fetch(request);
    },
  };
}

const GROUPS = [
  "plant",
  "devices",
  "writes",
  "connections",
  "tariff",
  "forecast",
  "access",
  "display",
  "about",
  "logs",
  "danger",
];

/** A control the browser draws itself, not one of components/ui. */
const NATIVE = [
  "select",
  "table:not([data-slot])",
  "input:is([type=number], [type=date], [type=datetime-local], [type=time], [type=range], [type=checkbox], [type=radio])",
  "button:not([data-slot])",
].join(", ");

function visible(element: Element): boolean {
  const { width, height } = element.getBoundingClientRect();

  return width > 0 && height > 0 && getComputedStyle(element).visibility !== "hidden";
}

/** Settings opened on `group` at 360 px, once its lists have loaded. */
async function narrow(group: string): Promise<HTMLElement> {
  await page.viewport(360, 780);

  const screen = await render(SettingsScreen, {
    core: connect(plant()),
    admin: true,
    open: group,
    onnavigate: () => null,
  });

  await expect.poll(() => document.querySelector("[aria-busy=true]")).toBeNull();
  await expect.element(screen.getByRole("region").first()).toBeVisible();

  return document.querySelector<HTMLElement>("[data-drill=box]")!;
}

test.each(GROUPS)("%s fits 360 px and draws every control from components/ui", async (group) => {
  const box = await narrow(group);

  const native = [...box.querySelectorAll(NATIVE)].flatMap((element) =>
    visible(element) ? [element.outerHTML.slice(0, 120)] : [],
  );

  expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(360);
  expect(native).toEqual([]);

  // Nothing pokes out past the box's right edge.
  const right = box.getBoundingClientRect().right + 0.5;

  const outside = [...box.querySelectorAll("*")].flatMap((element) =>
    visible(element) && element.getBoundingClientRect().right > right
      ? [element.outerHTML.slice(0, 120)]
      : [],
  );

  expect(outside).toEqual([]);
});

test.each(GROUPS)("%s shows no setting's key as a label", async (group) => {
  const box = await narrow(group);

  // Loaded lists read the same at every key's place: by role, profile name or words.
  await expect.poll(() => box.innerText.length).toBeGreaterThan(0);

  for (const key of KEYS) expect(box.innerText).not.toContain(key);
});
