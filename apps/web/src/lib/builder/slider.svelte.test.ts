import "../../app.css";
import { beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
import { connect, type Corrections, type ModuleType, type Transport } from "../api/core.ts";
import Builder from "./Builder.svelte";
import { emptyDraft } from "./modules.ts";
import { loadPv } from "./pv.ts";
import { fill } from "./templates.ts";
import { pickDay, savedFrom, scrub } from "./moment.harness.ts";

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
    ...fill(emptyDraft(), "gable").scene,
    grids: [
      {
        block: 0,
        face: 1,
        moduleType: 7,
        landscape: false,
        setback: 0.3,
        modules: [
          { across: 0.3, up: 0.3, landscape: false, string: 0, optimized: false },
          { across: 1.454, up: 0.3, landscape: false, string: 0, optimized: false },
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

        const points = [
          {
            start: new Date(noon).toISOString(),
            end: new Date(noon + 3_600_000).toISOString(),
            mean: 812,
          },
        ];

        return Response.json({
          series: url.searchParams.getAll("series").map((series) => ({
            series,
            tier: "bucket",
            points,
          })),
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

  await pickDay("Tag", "2026-11-01");
  await scrub(750);

  await expect.element(screen.getByText("12:30")).toBeVisible();
  await expect.element(screen.getByText("Gemessen oder geschätzt")).toBeVisible();
  await expect
    .element(screen.getByRole("list", { name: "Leistung je String" }))
    .toHaveTextContent("Süd: 812 W");
  await expect.element(screen.getByRole("button", { name: "Rückgängig" })).toBeDisabled();

  await savedFrom("2026-11-01");

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

  await pickDay("Tag", "2030-06-21");
  await scrub(780);

  await expect.element(screen.getByText("Klarer Himmel, berechnet")).toBeVisible();
  const list = screen.getByRole("list", { name: "Leistung je String" });

  await expect.poll(() => list.element().textContent).toMatch(/Süd: ≈[1-9][\d.]* W/u);
});

test("the scene's sky is the weather of the slider's day", async () => {
  const asked: string[] = [];
  const reading = readingCore(() => ({ inputs: [] }));

  await render(Builder, {
    pv,
    core: connect({
      ...reading,
      fetch: (request) => {
        asked.push(request.url);

        return reading.fetch(request);
      },
    }),
    start: SAVED,
    moduleTypes: [MODULE],
    devices: DEVICES,
    location: BERLIN,
  });

  await pickDay("Tag", "2026-11-01");

  // The day in the browser's calendar, midnight to midnight.
  const day = new URLSearchParams({
    from: new Date("2026-11-01T00:00").toISOString(),
    to: new Date("2026-11-02T00:00").toISOString(),
  }).toString();

  // One request a source names every series it reads.
  const weather = (route: string, series: string) =>
    asked.find(
      (url) =>
        url.includes(`/devices/4294967295/${route}?`) &&
        new URL(url).searchParams.getAll("series").includes(series) &&
        url.endsWith(day),
    );

  await expect.poll(() => weather("forecasts", "weather.ghi")).toBeDefined();
  await expect.poll(() => weather("forecasts", "weather.dhi")).toBeDefined();
  // A past day's sky is the measured one, and its weather the archive's.
  await expect.poll(() => weather("history", "weather.clearness")).toBeDefined();
  await expect.poll(() => weather("history", "weather.code")).toBeDefined();
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

  await pickDay("Tag", "2026-11-01");
  await scrub(750);

  // Beside the strings it judges, in the inspector.
  await screen.getByRole("button", { name: /^Strings/u }).click();

  await expect
    .element(screen.getByRole("list", { name: "Modell gegen Messung" }))
    .toHaveTextContent(
      "Deye · MPPT 1: Korrektur 0,92 · letzte 30 Tage 120 kWh gemessen, 135 kWh berechnet (−11 %)",
    );
});
