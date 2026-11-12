import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Live, type Transport } from "../api/core.ts";
import Flow2d from "./Flow2d.svelte";

const PLANT = "4294967294";
const INVERTER = "1";

const WIRING = { device: 1, input: 1, azimuth: 0, tilt: 30, loss: 0, moduleType: 1, modules: 10 };

const STRINGS = [
  { id: 1, name: "Süd", optimized: 0, ...WIRING },
  { id: 2, name: "Nord", optimized: 0, ...WIRING },
];

/** Midday: two strings, the battery charging, the rest fed in. */
const MIDDAY = {
  [PLANT]: {
    "pv.power": 4200,
    "battery.power": 1500,
    "battery.soc": 64,
    "grid.power": -1800,
    "load.power": 900,
  },
  [INVERTER]: { "inverter.power": 4100, "pv.string.power[1]": 2500, "pv.string.power[2]": 1700 },
};

function answer(href: string): Response {
  switch (new URL(href).pathname) {
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
            estimated: ["pv.string.power[2]"],
          },
        },
      });
    default:
      return Response.json({ status: 404, code: "not_found" }, { status: 404 });
  }
}

const transport: Transport = {
  base: "http://core.test/",
  fetch: (request) => Promise.resolve(answer(request.url)),
};

/** The flow over `live`, sized like a landscape hero, once the layout has arrived. */
async function show(live: Live) {
  const onselect = vi.fn<(id: string) => void>();
  const screen = await render(Flow2d, { core: connect(transport), live, top: 0, onselect });

  screen.container.style.cssText = "position: relative; width: 900px; height: 560px";
  // The strings arrive with the layout.
  await expect.element(screen.getByRole("button", { name: "Süd: Details" })).toBeVisible();

  return { screen, onselect };
}

test("a node opens its detail sheet, the hub the inverter's", async () => {
  const { screen, onselect } = await show({ devices: MIDDAY });

  await screen.getByRole("button", { name: "Batterie: Details" }).click();
  await screen.getByRole("button", { name: "Süd: Details" }).click();
  await screen.getByRole("button", { name: "Wechselrichter: Details" }).click();

  expect(onselect.mock.calls).toEqual([["battery"], ["string-1"], ["inverter"]]);
});

test("each rail is drawn in its flow's energy colour", async () => {
  const { screen } = await show({ devices: MIDDAY });
  const cables = [...screen.container.querySelectorAll("path[id]")];

  // A lit rail's group paints its cable's path in the flow's colour.
  const colour = (segment: string) => {
    const d = cables.find((c) => c.id.endsWith(`-cable-${segment}`))?.getAttribute("d");

    const lit = [...screen.container.querySelectorAll("svg g[style]")].find(
      (g) => g.querySelector("path:not([id])")?.getAttribute("d") === d,
    );

    return lit?.getAttribute("style");
  };

  await expect.poll(() => colour("battery-hub")).toContain("var(--e-battery)");
  expect(colour("string-1-hub")).toContain("var(--e-solar)");
  expect(colour("grid-hub")).toContain("var(--e-export)");
  expect(colour("house-hub")).toContain("var(--e-house)");
});

test("an unchanged reading leaves every crossing time byte-identical", async () => {
  const { screen } = await show({ devices: MIDDAY });

  const durs = () =>
    [...screen.container.querySelectorAll("svg animateMotion")].map((a) => a.getAttribute("dur"));

  await expect.poll(() => durs().length).toBeGreaterThan(0);
  const before = durs();

  await screen.rerender({ live: { devices: structuredClone(MIDDAY) } });

  expect(durs()).toEqual(before);
});

test("an estimated string carries ≈", async () => {
  const { screen } = await show({ devices: MIDDAY });

  await expect.element(screen.getByTitle("geschätzt")).toBeVisible();
  expect(screen.getByTitle("geschätzt").elements()).toHaveLength(1);
});

test("a stalled plant stops the charges", async () => {
  const { screen } = await show({
    devices: MIDDAY,
    stale: { [PLANT]: { "pv.power": Date.now() - 60_000 } },
  });

  await expect.element(screen.getByRole("button", { name: "Batterie: Details" })).toBeVisible();
  expect(screen.container.querySelectorAll("animateMotion")).toHaveLength(0);
});
