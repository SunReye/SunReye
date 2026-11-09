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

async function gridOnTheSouthFace(transport: Transport) {
  const screen = await render(Builder, {
    pv,
    core: connect(transport),
    start: emptyDraft(),
    moduleTypes: [MODULE],
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
