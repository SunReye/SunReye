import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import Dashboard from "../dashboard/Dashboard.svelte";

const PLANT = "4294967294";
const SPOT = "4294967292";
const INVERTER = "1";
const BATTERY = "2";

/** Midday: the plant's totals, an inverter with two inputs and a battery. */
const LIVE = {
  [PLANT]: { "pv.power": 4200, "load.power": 900, "grid.power": -3300, "battery.power": 0 },
  [SPOT]: { "price.spot": 0.061 },
  [INVERTER]: {
    "pv.power": 4200,
    "inverter.power": 4100,
    "inverter.status": 1,
    "pv.mppt.power[1]": 2500,
    "pv.mppt.power[2]": 1700,
    "pv.string.power[1]": 1500,
    "pv.string.power[2]": 1000,
  },
  [BATTERY]: { "battery.power": 0, "battery.soc": 64, "battery.cycles": 412 },
};

const WIRING = { device: 1, input: 1, azimuth: 0, tilt: 30, loss: 0, moduleType: 1, modules: 10 };

const STRINGS = [
  { id: 1, name: "Süd", optimized: 0, ...WIRING },
  { id: 2, name: "Nord", optimized: 0, ...WIRING },
];

/** What the core streams: the live values, and each stale value's age in seconds. */
interface Served {
  live: typeof LIVE;
  stale: Readonly<Record<string, Readonly<Record<string, number>>>> | undefined;
}

const served: Served = { live: LIVE, stale: undefined };

function stream(): Response {
  const frame = { devices: served.live, ...(served.stale && { stale: served.stale }) };
  const body = `event: snapshot\ndata: ${JSON.stringify(frame)}\n\n`;

  return new Response(
    new ReadableStream({
      start: (controller) => {
        controller.enqueue(new TextEncoder().encode(body));
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

const slot = (hour: number, value: number) => ({
  issued: "2026-11-11T13:00:00Z",
  target: `2026-11-12T${String(hour).padStart(2, "0")}:00:00Z`,
  value,
});

function answer(href: string): Response {
  const { pathname } = new URL(href);

  switch (pathname) {
    case "/api/v1/live":
      return stream();
    case "/api/v1/timezone":
      return Response.json({ name: "UTC" });
    case "/api/v1/layout":
      return Response.json({ appliesFrom: "2026-11-01T00:00:00Z", strings: STRINGS, warnings: [] });
    case "/api/v1/capabilities":
      return Response.json({
        capabilities: [],
        schema: {},
        transports: [],
        version: "5",
        devices: {
          [INVERTER]: {
            series: [],
            settings: [],
            writes: false,
            estimated: ["pv.string.power[1]", "pv.string.power[2]"],
          },
        },
      });
    case `/api/v1/devices/${SPOT}/forecasts`:
      return Response.json({ points: [slot(0, 0.12), slot(12, 0.061), slot(13, -0.01)] });
    case "/api/v1/devices":
      return Response.json({ status: 403, code: "auth.forbidden" }, { status: 403 });
    case "/api/v1/costs":
      return Response.json({ days: [], total: { paid: 0.32, earned: 0.33, saved: 2.1 } });
    default:
      return Response.json({ points: [] });
  }
}

const transport: Transport = {
  base: "http://core.test/",
  fetch: (request) => Promise.resolve(answer(request.url)),
};

beforeEach(async () => {
  served.live = LIVE;
  served.stale = undefined;
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-12T12:20:00Z") });
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await page.viewport(1280, 800);
});

afterEach(async () => {
  vi.useRealTimers();
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

async function show(detail: string | null = null) {
  const onopen = vi.fn<(id: string) => void>();
  const onclose = vi.fn<() => void>();

  const screen = await render(Dashboard, {
    core: connect(transport),
    layout: null,
    admin: false,
    detail,
    onopen,
    onclose,
  });

  return { screen, onopen, onclose };
}

test("a dashboard figure asks to open its detail", async () => {
  const { screen, onopen } = await show();

  await screen.getByRole("button", { name: /Spotpreis/u }).click();

  expect(onopen).toHaveBeenCalledWith("price");
});

test("the price sheet charts today's spot prices with their CC BY attribution", async () => {
  const { screen } = await show("price");
  const sheet = screen.getByRole("dialog", { name: "Spotpreis" });

  await expect.element(sheet.getByRole("img", { name: "Spotpreise heute" })).toBeVisible();
  await expect
    .poll(() =>
      [...document.querySelectorAll("[data-price]")].map((b) =>
        b instanceof HTMLElement ? b.dataset.price : null,
      ),
    )
    .toEqual(["0.12", "0.061", "-0.01"]);
  // The slot in force at 12:20 is noon's.
  expect(document.querySelector<HTMLElement>("[data-now]")?.dataset.price).toBe("0.061");
  await expect.element(sheet.getByText("00:00")).toBeVisible();
  await expect
    .element(sheet.getByRole("link", { name: "CC BY 4.0" }))
    .toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
});

test("every sheet ends with History at its range", async () => {
  const { screen } = await show("production");

  await expect
    .element(screen.getByRole("link", { name: /Im Verlauf öffnen · Heute/u }))
    .toHaveAttribute("href", "#/history?range=day");
});

test("a device's sheet lists its readings by group", async () => {
  const { screen } = await show("battery");
  const readings = screen.getByRole("region", { name: "Messwerte" });

  await expect.element(readings.getByText("Zyklen")).toBeVisible();
  await expect.element(readings.getByText("Zähler")).toBeVisible();
});

test("a string sharing its input is estimated and opens its sibling", async () => {
  const { screen, onopen } = await show("string-1");
  const sheet = screen.getByRole("dialog", { name: "Süd" });

  await expect.element(sheet.getByText(/misst seine 2 Strings gemeinsam/u)).toBeVisible();
  await sheet.getByRole("button", { name: /Nord/u }).click();

  expect(onopen).toHaveBeenCalledWith("string-2");
});

test("an offline device is stated once above its readings", async () => {
  const at = 5 * 60;
  served.stale = { [BATTERY]: { "battery.power": at, "battery.soc": at, "battery.cycles": at } };

  const { screen } = await show("battery");

  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Gerät antwortet nicht · letzte Werte vor 5 min");
});

test("Escape asks to close the sheet", async () => {
  const { screen, onclose } = await show("price");

  await expect.element(screen.getByRole("dialog")).toBeVisible();
  await userEvent.keyboard("{Escape}");

  expect(onclose).toHaveBeenCalledOnce();
});

test("the scrim dims the page without blurring it", async () => {
  const { screen } = await show("price");

  await expect.element(screen.getByRole("dialog")).toBeVisible();

  const scrim = document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]');

  expect(scrim && getComputedStyle(scrim).backdropFilter).toBe("none");
});

test("a sheet enters in about 350 ms easing out and leaves faster, easing in", async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });

  const { screen } = await show("price");
  const sheet = screen.getByRole("dialog");

  await expect.element(sheet).toBeVisible();

  const entering = getComputedStyle(sheet.element());

  expect(entering.animationDuration).toBe("0.35s");
  expect(entering.animationTimingFunction).toBe("cubic-bezier(0.215, 0.61, 0.355, 1)");

  await screen.rerender({ detail: null });
  await expect.element(sheet).toHaveAttribute("data-state", "closed");

  const leaving = getComputedStyle(sheet.element());

  expect(leaving.animationDuration).toBe("0.15s");
  expect(leaving.animationTimingFunction).toBe("cubic-bezier(0.55, 0.055, 0.675, 0.19)");
});

// Last: touch emulation cannot be undone (pointer stays `none`).
test("on a desktop it is a side sheet, on a phone a bottom sheet", async () => {
  const wide = await show("price");

  await expect.element(wide.screen.getByRole("dialog")).toHaveAttribute("data-side", "right");
  await wide.screen.unmount();

  await page.viewport(390, 844);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true });

  try {
    const phone = await show("price");

    await expect.element(phone.screen.getByRole("dialog")).toHaveAttribute("data-side", "bottom");
  } finally {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
});
