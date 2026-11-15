import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import Builder from "./Builder.svelte";
import {
  cellsOnPage,
  desk,
  DEVICES,
  drill,
  enter,
  house,
  inspector,
  MODULE,
  press,
  pv,
  SOUTH,
  undesk,
} from "./builder.harness.ts";
import { addGrid, emptyDraft } from "./modules.ts";

// Module types in the builder (ADR 17, 20): a face's modules start from a type the admin picks or
// enters from its datasheet; the core keeps it.

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
});

const { id: _, ...DATASHEET } = MODULE;

/** AIKO's A450 as its datasheet prints it. */
const A450 = {
  name: "AIKO-A450-MAH54Db",
  pmax: 450,
  vmp: 34.5,
  imp: 13.05,
  voc: 40.94,
  isc: 14.12,
  powerCoefficient: -0.26,
  voltageCoefficient: -0.22,
  currentCoefficient: 0.05,
  width: 1.134,
  height: 1.757,
  bypassDiodes: 3,
};

/** The module catalogue: two AIKO power classes and one LONGi. */
const CATALOGUE = {
  sheets: [
    {
      maker: "AIKO",
      series: "Neostar 2S+",
      source: {
        title: "Neostar 2S+ AIKO-A-MAH54Db",
        revision: "DS_EN_2405_V1.5",
        url: "https://a",
      },
      modules: [{ ...A450, name: "AIKO-A440-MAH54Db", pmax: 440, imp: 12.8 }, A450],
    },
    {
      maker: "LONGi",
      series: "Hi-MO 6",
      source: { title: "Hi-MO 6 Explorer LR5-54HTH", revision: "20230210V17", url: "https://l" },
      modules: [{ ...A450, name: "LR5-54HTH-430M", pmax: 430 }],
    },
  ],
};

/** A core without module types that keeps each one added, or refuses it with `refusal` at
 * `pointer`. */
function emptyCore(refusal?: string, pointer?: string): Transport & { readonly posts: unknown[] } {
  const posts: unknown[] = [];

  return {
    base: "http://core.test/",
    posts,
    fetch: async (request) => {
      if (request.url.endsWith("/api/v1/module-catalogue")) return Response.json(CATALOGUE);

      if (request.method !== "POST" || !request.url.endsWith("/api/v1/module-types")) {
        return Promise.withResolvers<Response>().promise;
      }

      const sheet: unknown = await request.json();

      posts.push(sheet);

      return refusal === undefined
        ? Response.json(Object.assign({ id: 9 }, sheet), { status: 201 })
        : Response.json(
            { type: "about:blank", title: "Unprocessable", status: 422, code: refusal, pointer },
            { status: 422, headers: { "content-type": "application/problem+json" } },
          );
    },
  };
}

function opened(transport: Transport) {
  return render(Builder, {
    pv,
    core: connect(transport),
    start: emptyDraft(),
    moduleTypes: [],
    devices: DEVICES,
  });
}

/** Enters MODULE's datasheet into the new module type's form. */
async function datasheet(): Promise<void> {
  await userEvent.fill(inspector().getByLabelText("Name"), MODULE.name);

  const rows: readonly (readonly [string, string])[] = [
    ["Pmax (W)", "400"],
    ["Vmp (V)", "34"],
    ["Imp (A)", "11,76"],
    ["Voc (V)", "41"],
    ["Isc (A)", "12,5"],
    ["Länge (mm)", "1722"],
    ["Breite (mm)", "1134"],
  ];

  for (const [row, value] of rows) {
    // oxlint-disable-next-line no-await-in-loop -- one value editor at a time.
    await enter(row, value);
  }
}

/** The face level's count of placed modules. */
/** The face level's count of placed modules, `count` a pattern. */
const placed = (count: string) =>
  inspector().getByText(new RegExp(`^${count} Module gesetzt$`, "u"));

test("from an empty core an admin creates a module type, fills a roof face and paints a string", async () => {
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const core = emptyCore();

  await opened(core);
  await page.getByRole("button", { name: "Einfamilienhaus mit Satteldach" }).click();

  await drill("Module", SOUTH, "Neuer Modultyp");
  await datasheet();
  await inspector().getByRole("button", { name: "Modultyp anlegen" }).click();

  expect(core.posts).toEqual([DATASHEET]);

  // The new type lays the face's grid at once.
  await inspector().getByRole("button", { name: "Fläche füllen" }).click();
  await expect.element(placed("16")).toBeVisible();

  await drill("Module", "Szene", "Strings", "String hinzufügen");
  await expect.poll(() => draws.mock.calls.length).toBeGreaterThan(0);

  const cells = cellsOnPage(addGrid(house().scene, 0, 1, MODULE.id), 0);

  await press("mouse", [cells("0.0")]);

  await drill("Strings");
  await expect.element(inspector().getByText(/^1 Module, davon 0 mit Optimierer$/u)).toBeVisible();
});

test("an existing module type is offered on the face, and picking it lays the grid", async () => {
  await render(Builder, {
    pv,
    core: connect(emptyCore()),
    start: emptyDraft(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });
  await page.getByRole("button", { name: "Einfamilienhaus mit Satteldach" }).click();

  await drill("Module", SOUTH, MODULE.name);

  await expect.element(inspector().getByRole("button", { name: "Fläche füllen" })).toBeVisible();
});

test("a new datasheet marks each value it needs and is not sent before they are entered", async () => {
  const core = emptyCore();

  await opened(core);
  await page.getByRole("button", { name: "Einfamilienhaus mit Satteldach" }).click();

  await drill("Module", SOUTH, "Neuer Modultyp");
  await userEvent.fill(inspector().getByLabelText("Name"), MODULE.name);

  await expect
    .element(inspector().getByRole("button", { name: "Pmax (W) Pflichtangabe" }))
    .toBeVisible();
  await expect
    .element(inspector().getByRole("button", { name: "Modultyp anlegen" }))
    .toBeDisabled();

  await datasheet();

  expect(inspector().getByText("Pflichtangabe").all()).toHaveLength(0);
  await expect.element(inspector().getByRole("button", { name: "Modultyp anlegen" })).toBeEnabled();
});

test("a datasheet the core refuses names the value and keeps what was entered", async () => {
  const core = emptyCore("layout.value", "/pmax");

  await opened(core);
  await page.getByRole("button", { name: "Einfamilienhaus mit Satteldach" }).click();

  await drill("Module", SOUTH, "Neuer Modultyp");
  await datasheet();
  await inspector().getByRole("button", { name: "Modultyp anlegen" }).click();

  await expect
    .element(inspector().getByRole("alert"))
    .toHaveTextContent("Pmax (W) liegt außerhalb seines physikalischen Bereichs.");
  await expect.element(inspector().getByLabelText("Name")).toHaveValue(MODULE.name);
  expect(core.posts).toHaveLength(1);
});

test("an admin picks an AIKO Neostar 2S+ from the module catalogue and fills a face with it", async () => {
  const core = emptyCore();

  await opened(core);
  await page.getByRole("button", { name: "Einfamilienhaus mit Satteldach" }).click();

  await drill("Module", SOUTH, "Aus dem Modulkatalog");
  await expect.element(inspector().getByText("LR5-54HTH-430M")).toBeVisible();
  await expect.element(inspector().getByText(/DS_EN_2405_V1\.5/u)).toBeVisible();

  await userEvent.fill(inspector().getByRole("searchbox", { name: "Modul suchen" }), "aiko 450");
  await expect.element(inspector().getByText("LR5-54HTH-430M")).not.toBeInTheDocument();
  await drill(A450.name);

  expect(core.posts).toEqual([A450]);

  await inspector().getByRole("button", { name: "Fläche füllen" }).click();
  await expect.element(placed(String.raw`[1-9]\d*`)).toBeVisible();
});
