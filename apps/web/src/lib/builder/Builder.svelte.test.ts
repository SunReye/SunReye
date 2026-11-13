import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import Builder from "./Builder.svelte";
import { addGrid } from "./modules.ts";
import {
  cellsOnPage,
  choose,
  desk,
  DEVICES,
  drill,
  enter,
  gridOnTheSouthFace,
  house,
  inspector,
  MODULE,
  press,
  pv,
  saveFrom,
  testCore,
  undesk,
} from "./builder.harness.ts";

const SLOW = { timeout: 15_000 };

/** How many frames the canvas drew, counted from before each test renders. */
let drawn = (): number => 0;

beforeEach(async () => {
  const draws = vi.spyOn(EffectComposer.prototype, "render");

  drawn = () => draws.mock.calls.length;
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
});

/** The south face's grid, laid out, and a press on its cell `row.column` in 3D. */
async function onTheRoof(): Promise<(key: string) => Promise<void>> {
  await expect.poll(drawn, SLOW).toBeGreaterThan(0);

  const cells = cellsOnPage(addGrid(house().scene, 0, 1, MODULE.id), 0);

  return (key) => press("mouse", [cells(key)]);
}

test("the admin lays modules, wires one into a string, undoes one and saves from a date", async () => {
  const transport = testCore();
  const screen = await gridOnTheSouthFace(transport);
  const roof = await onTheRoof();

  await roof("0.0");
  await roof("0.1");
  await inspector().getByRole("button", { name: "Rückgängig" }).click();
  await expect.element(inspector().getByText("1 von 16 Modulen gesetzt")).toBeVisible();

  await drill("Module", "Szene", "Strings", "String hinzufügen");
  await roof("0.0");
  await drill("Strings");
  await expect.element(inspector().getByText("1 Module, davon 0 mit Optimierer")).toBeVisible();

  await saveFrom("2026-11-01");

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
          modules: [{ row: 0, column: 0, string: 0, optimized: false, order: 0 }],
        },
      ],
    },
  });
  // A save is one change: nothing is left to undo.
  await expect.element(screen.getByRole("button", { name: "Rückgängig" })).toBeDisabled();
});

test("a module the setback no longer holds is flagged before saving", async () => {
  const screen = await gridOnTheSouthFace(testCore());
  const roof = await onTheRoof();

  await roof("1.0");
  // A tap on the module selects it.
  await roof("1.0");
  await inspector().getByRole("checkbox", { name: "Optimierer" }).click();
  await drill("Baukörper 1, Fläche 2");

  await enter("Randabstand (m)", "1");

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(
      "Raster 1: Das Modul in Reihe 2, Spalte 1 ragt über den Randabstand oder in einen Schornstein.",
    );
  await drill("Module");
  await expect
    .element(inspector().getByText("1 Module gehören zu keinem String und erzeugen nichts."))
    .toBeVisible();
});

test("the admin hangs a battery marker inside the right wall and saves it with the scene", async () => {
  const transport = testCore();
  const screen = await gridOnTheSouthFace(transport);

  await drill("Module", "Szene", "Geräte", "Batterie platzieren");
  await choose("Gerät", "Speicher");
  await choose("Wand", "Rechts");
  await enter("Abstand vom linken Ende (m)", "3");
  await inspector().getByRole("checkbox", { name: "Innen" }).click();

  await saveFrom("2026-11-01");

  await expect.element(screen.getByRole("status")).toHaveTextContent("Gespeichert.");
  expect(transport.puts[0]).toMatchObject({
    scene: {
      equipment: [{ device: 2, kind: "battery", block: 0, wall: "right", along: 3, inside: true }],
    },
  });
});

test("the admin adds a car place under a carport, paints it, uploads a GLB and saves", async () => {
  const transport = testCore();
  const screen = await gridOnTheSouthFace(transport);

  await drill("Module", "Szene", "Gebäude", "Baukörper hinzufügen");
  await inspector().getByRole("checkbox", { name: "Carport" }).click();
  await drill("Gebäude", "Szene", "Geräte", "Stellplatz hinzufügen");

  const paint = inspector().getByLabelText("Farbe").element();

  if (!(paint instanceof HTMLInputElement)) throw new TypeError("no colour input");

  paint.value = "#c0392b";
  paint.dispatchEvent(new Event("change", { bubbles: true }));
  await userEvent.upload(
    inspector().getByLabelText("Eigenes Modell (GLB, höchstens 20 MB)").element(),
    new File([new Uint8Array([0x67, 0x6c, 0x54, 0x46])], "car.glb"),
  );
  await expect
    .element(inspector().getByRole("button", { name: "Eigenes Modell entfernen" }))
    .toBeVisible();

  await saveFrom("2026-11-01");

  await expect.element(screen.getByRole("status")).toHaveTextContent("Gespeichert.");
  expect(transport.puts[0]).toMatchObject({
    scene: {
      blocks: [{ x: 0 }, { open: true }],
      carPlaces: [{ device: 3, colour: "#c0392b", model: "ab".repeat(32) }],
    },
  });
  expect(JSON.stringify(transport.puts[0])).not.toContain("class");
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
    ...house(),
    scene: {
      ...house().scene,
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

  await expect.element(unplugged.getByLabelText("3D-Szene des Hauses")).toBeVisible();
  expect(unplugged.getByText(/Auto lädt/u).elements()).toHaveLength(0);
});
