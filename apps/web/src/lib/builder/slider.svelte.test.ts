import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
import { connect, type Corrections, type ModuleType, type Transport } from "../api/core.ts";
import Builder from "./Builder.svelte";
import { emptyDraft } from "./modules.ts";
import { loadPv } from "./pv.ts";

// The builder's time slider (ADR 20): it reads history, forecasts and a clear sky, and never
// changes the scene.

const pv = await loadPv(new Uint8Array(await (await fetch(wasm)).arrayBuffer()));

const MODULE: ModuleType = {
  id: 7,
  name: "Owner 400",
  pmax: 400,
  vmp: 34,
  imp: 11.76,
  voc: 41,
  isc: 12.5,
  powerCoefficient: -0.35,
  voltageCoefficient: -0.27,
  currentCoefficient: 0.05,
  width: 1.134,
  height: 1.722,
  bypassDiodes: 3,
};

const DEVICES = [{ id: 1, name: "Deye", profile: "deye-sg05lp3", connection: 1, unit: 1 }];

beforeEach(async () => {
  await page.viewport(1280, 900);
});

/** The default house with two modules of string 5 on its south face, saved. */
const SAVED = {
  scene: {
    ...emptyDraft().scene,
    grids: [
      {
        block: 0,
        face: 1,
        moduleType: 7,
        landscape: false,
        setback: 0.3,
        modules: [
          { row: 0, column: 0, string: 0, optimized: false },
          { row: 0, column: 1, string: 0, optimized: false },
        ],
      },
    ],
  },
  strings: [
    {
      id: 5,
      name: "Süd",
      moduleType: 7,
      device: 1,
      input: 1,
      modules: 2,
      optimized: 0,
      tilt: 35,
      azimuth: 0,
      loss: 2,
    },
  ],
};

/** A core with an hour of string 5 measured at noon, the given corrections, and every PUT. */
function readingCore(corrections: () => Corrections): Transport & { readonly puts: unknown[] } {
  const puts: unknown[] = [];

  return {
    base: "http://core.test/",
    puts,
    fetch: async (request) => {
      const url = new URL(request.url);

      if (request.method === "PUT") {
        puts.push(await request.json());

        return Response.json({ appliesFrom: "2026-10-31T23:00:00Z", strings: SAVED.strings });
      }

      if (url.pathname.endsWith("/history")) {
        // Local midnight; no clock change on the days asked.
        const noon = Date.parse(url.searchParams.get("from") ?? "") + 12 * 3_600_000;

        return Response.json({
          tier: "bucket",
          points: [
            {
              start: new Date(noon).toISOString(),
              end: new Date(noon + 3_600_000).toISOString(),
              mean: 812,
            },
          ],
        });
      }

      if (url.pathname.endsWith("/corrections")) return Response.json(corrections());

      return Promise.withResolvers<Response>().promise;
    },
  };
}

const BERLIN = { latitude: 52.52, longitude: 13.38 };

test("the slider shows a past day's measured string power and changes nothing in the scene", async () => {
  const transport = readingCore(() => ({ inputs: [] }));

  const screen = await render(Builder, {
    pv,
    core: connect(transport),
    start: SAVED,
    moduleTypes: [MODULE],
    devices: DEVICES,
    location: BERLIN,
  });

  await userEvent.fill(screen.getByLabelText("Tag"), "2026-11-01");
  await userEvent.fill(screen.getByRole("slider", { name: "Uhrzeit" }), "750");

  await expect.element(screen.getByText("12:30")).toBeVisible();
  await expect.element(screen.getByText("Gemessen oder geschätzt")).toBeVisible();
  await expect
    .element(screen.getByRole("list", { name: "Leistung je String" }))
    .toHaveTextContent("Süd: 812 W");
  await expect.element(screen.getByRole("button", { name: "Rückgängig" })).toBeDisabled();

  await userEvent.fill(screen.getByLabelText("Gilt ab"), "2026-11-01");
  await screen.getByRole("button", { name: "Speichern" }).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent("Gespeichert.");
  expect(transport.puts[0]).toMatchObject({ scene: SAVED.scene });
});

test("a far day runs a clear sky in the browser", async () => {
  const screen = await render(Builder, {
    pv,
    core: connect(readingCore(() => ({ inputs: [] }))),
    start: SAVED,
    moduleTypes: [MODULE],
    devices: DEVICES,
    location: BERLIN,
  });

  await userEvent.fill(screen.getByLabelText("Tag"), "2030-06-21");
  await userEvent.fill(screen.getByRole("slider", { name: "Uhrzeit" }), "780");

  await expect.element(screen.getByText("Klarer Himmel, berechnet")).toBeVisible();
  const list = screen.getByRole("list", { name: "Leistung je String" });

  await expect.poll(() => list.element().textContent).toMatch(/Süd: ≈[1-9][\d.]* W/u);
});

test("each MPPT input shows its learned correction at the slider's hour and its last 30 days", async () => {
  const screen = await render(Builder, {
    pv,
    core: connect(
      readingCore(() => ({
        inputs: [
          {
            device: 1,
            input: 1,
            factors: [{ month: 11, hour: 12, factor: 0.92 }],
            recent: { measured: 120, modelled: 135 },
          },
        ],
      })),
    ),
    start: SAVED,
    moduleTypes: [MODULE],
    devices: DEVICES,
    location: BERLIN,
  });

  await userEvent.fill(screen.getByLabelText("Tag"), "2026-11-01");
  await userEvent.fill(screen.getByRole("slider", { name: "Uhrzeit" }), "750");

  await expect
    .element(screen.getByRole("list", { name: "Modell gegen Messung" }))
    .toHaveTextContent(
      "Deye · MPPT 1: Korrektur 0,92 · letzte 30 Tage 120 kWh gemessen, 135 kWh berechnet (−11 %)",
    );
});
