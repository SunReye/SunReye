import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import wasm from "../../../../../target/wasm32-unknown-unknown/release/sunreye_pv_wasm.wasm?url";
import { connect, type ModuleType, type Transport } from "../api/core.ts";
import Builder from "./Builder.svelte";
import { emptyDraft } from "./modules.ts";
import { loadPv } from "./pv.ts";

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

/** The south face of the default 10 m × 8 m gable house. */
const SOUTH = "Baukörper 1, Fläche 2: Azimut 0°, Neigung 35°";

/** A core that keeps each layout change and answers it saved, with a cold-voltage warning. */
function testCore(): Transport & { readonly puts: unknown[] } {
  const puts: unknown[] = [];

  return {
    base: "http://core.test/",
    puts,
    fetch: async (request) => {
      // The live stream stays open and silent.
      if (request.method === "GET") return Promise.withResolvers<Response>().promise;

      if (request.url.endsWith("/api/v1/car-bodies")) {
        return Response.json({ id: "ab".repeat(32) }, { status: 201 });
      }

      const change: unknown = await request.json();

      puts.push(change);

      return Response.json({
        appliesFrom: "2026-10-31T23:00:00Z",
        strings: [
          {
            id: 5,
            name: "String 1",
            moduleType: 7,
            device: 1,
            input: 1,
            modules: 1,
            optimized: 0,
            tilt: 35,
            azimuth: 0,
            loss: 2,
          },
        ],
        warnings: [{ string: 5, openCircuitVoltage: 807.741, maxInputVoltage: 800 }],
      });
    },
  };
}

beforeEach(async () => {
  await page.viewport(1280, 900);
});

const DEVICES = [
  { id: 1, name: "Deye", profile: "deye-sg05lp3", connection: 1, unit: 1 },
  { id: 2, name: "Speicher", profile: "pylontech", connection: 1, unit: 2 },
  { id: 3, name: "Wallbox", profile: "evcc", connection: 2, unit: 1 },
];

async function gridOnTheSouthFace(transport: Transport) {
  const screen = await render(Builder, {
    pv,
    core: connect(transport),
    start: emptyDraft(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Dachfläche" }).element(),
    SOUTH,
  );
  await screen.getByRole("button", { name: "Modulraster auf diese Fläche legen" }).click();

  return screen;
}

test("the admin paints modules into a string, undoes one and saves from a date", async () => {
  const transport = testCore();
  const screen = await gridOnTheSouthFace(transport);

  await screen.getByRole("button", { name: "String hinzufügen" }).click();
  await screen.getByRole("radio", { name: "String 1 malen" }).click();
  await screen.getByRole("button", { name: "Reihe 1, Spalte 1" }).click();
  await screen.getByRole("button", { name: "Reihe 1, Spalte 2" }).click();
  await screen.getByRole("button", { name: "Rückgängig" }).click();

  await expect
    .element(screen.getByRole("button", { name: "Reihe 1, Spalte 2" }))
    .toHaveAttribute("aria-pressed", "false");
  await expect.element(screen.getByText("1 Module, davon 0 mit Optimierer")).toBeVisible();

  await userEvent.fill(screen.getByLabelText("Gilt ab"), "2026-11-01");
  await screen.getByRole("button", { name: "Speichern" }).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent("Gespeichert.");
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(
      "String 1: 808 V Leerlaufspannung bei −10 °C übersteigen die 800 V des Wechselrichters.",
    );
  expect(transport.puts).toHaveLength(1);
  expect(transport.puts[0]).toMatchObject({
    appliesFrom: new Date("2026-11-01T00:00").toISOString(),
    strings: [{ name: "String 1", moduleType: 7, modules: 1 }],
    scene: {
      grids: [
        {
          block: 0,
          face: 1,
          moduleType: 7,
          landscape: false,
          setback: 0.3,
          modules: [{ row: 0, column: 0, string: 0, optimized: false }],
        },
      ],
    },
  });
  // A save is one change: nothing is left to undo.
  await expect.element(screen.getByRole("button", { name: "Rückgängig" })).toBeDisabled();
});

test("a module the setback no longer holds is flagged before saving", async () => {
  const screen = await gridOnTheSouthFace(testCore());

  await screen.getByRole("button", { name: "Reihe 2, Spalte 1" }).click();
  await screen.getByRole("radio", { name: "Optimierer" }).click();
  await screen.getByRole("button", { name: "Reihe 2, Spalte 1" }).click();

  await expect
    .element(screen.getByRole("button", { name: "Reihe 2, Spalte 1" }))
    .toHaveTextContent("◆");
  await expect
    .element(screen.getByText("1 Module gehören zu keinem String und erzeugen nichts."))
    .toBeVisible();

  await userEvent.fill(screen.getByRole("spinbutton", { name: "Randabstand (m)" }), "1");

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Raster 1: Das Modul in Reihe 2, Spalte 1 ragt über den Randabstand.");
});

test("the admin hangs a battery marker inside the right wall and saves it with the scene", async () => {
  const transport = testCore();
  const screen = await gridOnTheSouthFace(transport);

  await screen.getByRole("button", { name: "Batterie platzieren" }).click();
  const marker = screen.getByRole("group", { name: "Batterie" });
  await userEvent.selectOptions(
    marker.getByRole("combobox", { name: "Gerät" }).element(),
    "Speicher",
  );
  await userEvent.selectOptions(marker.getByRole("combobox", { name: "Wand" }).element(), "Rechts");
  await userEvent.fill(
    marker.getByRole("spinbutton", { name: "Abstand vom linken Ende (m)" }),
    "3",
  );
  await marker.getByRole("checkbox", { name: "Innen" }).click();

  await userEvent.fill(screen.getByLabelText("Gilt ab"), "2026-11-01");
  await screen.getByRole("button", { name: "Speichern" }).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent("Gespeichert.");
  expect(transport.puts[0]).toMatchObject({
    scene: {
      equipment: [{ device: 2, kind: "battery", block: 0, wall: "right", along: 3, inside: true }],
    },
  });
});

test("the admin adds a car place under a carport, picks its body, uploads a GLB and saves", async () => {
  const transport = testCore();
  const screen = await gridOnTheSouthFace(transport);

  await screen.getByRole("button", { name: "Baukörper hinzufügen" }).click();
  await screen
    .getByRole("group", { name: "Baukörper 2" })
    .getByRole("checkbox", { name: "Carport" })
    .click();
  await screen.getByRole("button", { name: "Stellplatz hinzufügen" }).click();

  const place = screen.getByRole("group", { name: "Stellplatz 1" });

  await userEvent.selectOptions(
    place.getByRole("combobox", { name: "Ladepunkt" }).element(),
    "Wallbox",
  );
  await userEvent.selectOptions(
    place.getByRole("combobox", { name: "Fahrzeugklasse" }).element(),
    "SUV",
  );
  await userEvent.upload(
    place.getByLabelText("Eigenes Modell (GLB, höchstens 20 MB)").element(),
    new File([new Uint8Array([0x67, 0x6c, 0x54, 0x46])], "car.glb"),
  );
  await expect
    .element(place.getByRole("button", { name: "Eigenes Modell entfernen" }))
    .toBeVisible();

  await userEvent.fill(screen.getByLabelText("Gilt ab"), "2026-11-01");
  await screen.getByRole("button", { name: "Speichern" }).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent("Gespeichert.");
  expect(transport.puts[0]).toMatchObject({
    scene: {
      blocks: [{ x: 0 }, { open: true }],
      carPlaces: [{ device: 3, body: { class: "suv", colour: "#8a8f98" }, model: "ab".repeat(32) }],
    },
  });
});

// One snapshot, then the stream stays open: an ended one would reconnect at once.
function live(connected: number): Response {
  const snapshot = JSON.stringify({
    devices: {
      "3": { "ev.connected": connected, "ev.charge.power": 7360, "ev.vehicle.soc": 63 },
    },
  });

  return new Response(
    new ReadableStream({
      start: (controller) => {
        controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${snapshot}\n\n`));
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("a connected car shows its charge power and SOC in the builder; none while unplugged", async () => {
  const parked = {
    ...emptyDraft(),
    scene: {
      ...emptyDraft().scene,
      carPlaces: [{ device: 3, x: 12, z: 0, width: 2.5, length: 5, rotation: 0 }],
    },
  };

  const show = (connected: number) =>
    render(Builder, {
      pv,
      core: connect({
        base: "http://core.test/",
        fetch: () => Promise.resolve(live(connected)),
      }),
      start: parked,
      moduleTypes: [MODULE],
      devices: DEVICES,
    });

  const plugged = await show(1);

  await expect
    .element(plugged.getByText("Wallbox: Auto lädt 7.360 W · Ladestand 63 %"))
    .toBeVisible();
  await plugged.unmount();

  const unplugged = await show(0);

  await expect.element(unplugged.getByRole("group", { name: "Stellplatz 1" })).toBeVisible();
  expect(unplugged.getByText(/Auto lädt/u).elements()).toHaveLength(0);
});
