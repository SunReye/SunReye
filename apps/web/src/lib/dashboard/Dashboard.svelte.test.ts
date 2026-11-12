import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import Dashboard from "./Dashboard.svelte";

const PLANT = "4294967294";
const TARIFF = "4294967293";
const SPOT = "4294967292";

/** A sunny noon: PV covers the house and feeds in, the spot price is low, a car charges. */
const NOON = {
  [PLANT]: { "pv.power": 4200, "load.power": 900, "grid.power": -3300 },
  [TARIFF]: { "price.import": 0.32, "price.export": 0.082 },
  [SPOT]: { "price.spot": 0.061 },
};

const LOADPOINT = { "ev.charge.power": 3700, "ev.vehicle.soc": 64, "ev.limit.soc": 80 };

const hour = (time: string, mean: number) => ({
  start: `2026-11-12T${time}:00Z`,
  end: `2026-11-12T${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}:00:00Z`,
  mean,
});

/** Today's plant history so far: one hour each. */
const HISTORY = new Map([
  ["pv.power", [hour("10", 8000)]],
  ["load.power", [hour("10", 4000)]],
  ["grid.power", [hour("10", -4000)]],
]);

const forecast = (value: number) => ({
  points: [{ issued: "2026-11-12T06:00:00Z", target: "2026-11-12T10:00:00Z", value }],
});

interface Served {
  live: Readonly<Record<string, Readonly<Record<string, number>>>> | null;
  /** Whether today's history, forecasts and money answer; held otherwise. */
  day: boolean;
  /** The admin's device list; a viewer is refused it. */
  devices: unknown[] | null;
}

const served: Served = { live: NOON, day: true, devices: null };

const held = () => Promise.withResolvers<Response>().promise;

/** The live stream: one snapshot, then held open, as one that ends reconnects at once. */
function snapshot(devices: Served["live"]): Promise<Response> {
  const body = `event: snapshot\ndata: ${JSON.stringify({ devices })}\n\n`;

  return Promise.resolve(
    new Response(
      new ReadableStream({
        start: (controller) => {
          controller.enqueue(new TextEncoder().encode(body));
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    ),
  );
}

/** Today's reads by path; any other forecast, an inverter's or the weather's, is empty. */
const DAY = new Map<string, (series: string) => Response>([
  ["/api/v1/timezone", () => Response.json({ name: "UTC" })],
  [
    "/api/v1/layout",
    () => Response.json({ appliesFrom: "2026-11-01T00:00:00Z", strings: [], warnings: [] }),
  ],
  [
    `/api/v1/devices/${PLANT}/history`,
    (series) => Response.json({ tier: "raw", points: HISTORY.get(series) ?? [] }),
  ],
  [`/api/v1/devices/${SPOT}/forecasts`, () => Response.json(forecast(0.061))],
  [
    "/api/v1/costs",
    () => Response.json({ days: [], total: { paid: 0.32, earned: 0.33, saved: 2.1 } }),
  ],
]);

function deviceList(): Response {
  return served.devices === null
    ? Response.json({ status: 403, code: "auth.forbidden" }, { status: 403 })
    : Response.json({ devices: served.devices });
}

function answer(href: string): Promise<Response> {
  const url = new URL(href);

  if (url.pathname === "/api/v1/live") return served.live === null ? held() : snapshot(served.live);

  if (url.pathname === "/api/v1/devices") return Promise.resolve(deviceList());

  if (!served.day) return held();

  const read = DAY.get(url.pathname) ?? (() => Response.json({ points: [] }));

  return Promise.resolve(read(url.searchParams.get("series") ?? ""));
}

const transport: Transport = {
  base: "http://core.test/",
  fetch: (request) => answer(request.url),
};

beforeEach(async () => {
  served.live = NOON;
  served.day = true;
  served.devices = null;
  // Figures land at once instead of counting up.
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await page.viewport(1280, 800);
});

afterEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

const open = () => render(Dashboard, { core: connect(transport), layout: null, admin: false });

/** The hero's large figure, read beside its label. */
function lead(): string | undefined {
  const label = page.getByText(/ jetzt$/u).element();

  return label.nextElementSibling?.textContent?.replaceAll(/\s+/gu, " ").trim();
}

test("while PV produces the hero leads with PV power", async () => {
  const screen = await open();

  await expect.element(screen.getByText("Erzeugung jetzt")).toBeVisible();
  await expect.poll(lead).toBe("4,2 kW");
});

test("while PV is idle the hero leads with house consumption", async () => {
  served.live = { [PLANT]: { "pv.power": 0, "load.power": 900, "grid.power": 900 } };

  const screen = await open();

  await expect.element(screen.getByText("Verbrauch jetzt")).toBeVisible();
  await expect.poll(lead).toBe("0,9 kW");
});

test("without a scene the hero shows the power flow, whose nodes open their details", async () => {
  const onopen = vi.fn<(id: string) => void>();

  const screen = await render(Dashboard, {
    core: connect(transport),
    layout: null,
    admin: false,
    onopen,
  });

  const hero = screen.getByRole("region", { name: "Anlage live" });

  await hero.getByRole("button", { name: "Netz: Details" }).click();
  await hero.getByRole("button", { name: "Wechselrichter: Details" }).click();

  expect(onopen.mock.calls).toEqual([["grid"], ["inverter"]]);
});

test("the now strip shows the spot price and the forecast PV still to come", async () => {
  const screen = await open();
  const now = screen.getByRole("group", { name: "Jetzt" });

  await expect.element(now.getByText("6,1", { exact: true })).toBeVisible();
  await expect.element(now.getByText("Spotpreis")).toBeVisible();
  await expect.element(now.getByText("PV noch heute")).toBeVisible();
});

test("today shows the plant's energy, its money and both meters", async () => {
  const screen = await open();
  const today = screen.getByRole("group", { name: "Heute" });

  // 8 kWh made, 4 used, 4 fed in, nothing bought.
  await expect.element(today.getByText("8,0", { exact: true })).toBeVisible();
  await expect.element(today.getByText("2,10 €")).toBeVisible();
  await expect
    .element(today.getByRole("progressbar", { name: "Autarkie" }))
    .toHaveAttribute("aria-valuenow", "100");
  await expect
    .element(today.getByRole("progressbar", { name: "Eigenverbrauch" }))
    .toHaveAttribute("aria-valuenow", "50");
});

test("labels are words, never role keys", async () => {
  served.live = { ...NOON, "7": LOADPOINT };

  const screen = await open();

  await expect.element(screen.getByText("Ladepunkt")).toBeVisible();
  expect(document.body.textContent).not.toMatch(/\b(?:pv|grid|load|ev|price)\.[a-z.]+/u);
});

test("a loadpoint shows on the EV card under its device's name", async () => {
  served.live = { ...NOON, "7": LOADPOINT };
  served.devices = [{ id: 7, name: "Wallbox Garage", profile: "evcc", connection: 2, unit: 1 }];

  const screen = await open();

  await expect.element(screen.getByText("Wallbox Garage")).toBeVisible();
  await expect.element(screen.getByText("Ziel 80 %")).toBeVisible();
});

test("without a loadpoint there is no EV card", async () => {
  const screen = await open();

  await expect.element(screen.getByText("Erzeugung jetzt")).toBeVisible();
  expect(screen.getByText("Ladepunkt").query()).toBeNull();
});

/** The height of each right-column block. */
function heights(): number[] {
  return ["Jetzt", "Heute"].map(
    (name) => page.getByRole("group", { name }).element().getBoundingClientRect().height,
  );
}

test("every figure holds its size before data arrives", async () => {
  served.live = null;
  served.day = false;

  const waiting = await open();

  await expect.element(waiting.getByRole("group", { name: "Heute" })).toBeVisible();
  expect(waiting.getByText("–,–").elements().length).toBeGreaterThan(4);

  const before = heights();

  await waiting.unmount();

  served.live = NOON;
  served.day = true;

  const loaded = await open();

  await expect.element(loaded.getByText("2,10 €")).toBeVisible();
  expect(heights()).toEqual(before);
});

test("on a landscape desktop the page fills the screen and never scrolls", async () => {
  const screen = await open();

  await expect.element(screen.getByText("2,10 €")).toBeVisible();
  expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(innerHeight);
});

test("on a phone the blocks scroll in order, hero first", async () => {
  await page.viewport(390, 844);

  const screen = await open();

  await expect.element(screen.getByText("2,10 €")).toBeVisible();

  const top = (name: string) =>
    screen
      .getByRole(name === "Anlage live" ? "region" : "group", { name })
      .element()
      .getBoundingClientRect().top;

  expect(top("Anlage live")).toBeLessThan(top("Jetzt"));
  expect(top("Jetzt")).toBeLessThan(top("Heute"));
  expect(document.documentElement.scrollHeight).toBeGreaterThan(innerHeight);
});

/** The backdrop blur behind a block. */
function blur(role: "group" | "region", name: string): string {
  return getComputedStyle(page.getByRole(role, { name }).element()).backdropFilter;
}

test("cards are ambient glass and the hero has none", async () => {
  const screen = await open();

  await expect.element(screen.getByRole("group", { name: "Heute" })).toBeVisible();
  expect(blur("group", "Heute")).not.toBe("none");
  expect(blur("region", "Anlage live")).toBe("none");
});
