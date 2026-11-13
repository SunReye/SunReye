import "../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import Builder from "./Builder.svelte";
import {
  desk,
  DEVICES,
  drill,
  enter,
  inspector,
  MODULE,
  pv,
  SOUTH,
  undesk,
} from "./builder.harness.ts";
import { emptyDraft } from "./modules.ts";

// Module types in the builder (ADR 17, 20): a face's modules start from a type the admin picks or
// enters from its datasheet; the core keeps it.

beforeEach(desk);

afterEach(undesk);

const { id: _, ...DATASHEET } = MODULE;

/** A core without module types that keeps each one added, or refuses it with `refusal`. */
function emptyCore(refusal?: string): Transport & { readonly posts: unknown[] } {
  const posts: unknown[] = [];

  return {
    base: "http://core.test/",
    posts,
    fetch: async (request) => {
      if (request.method !== "POST" || !request.url.endsWith("/api/v1/module-types")) {
        return Promise.withResolvers<Response>().promise;
      }

      const sheet: unknown = await request.json();

      posts.push(sheet);

      return refusal === undefined
        ? Response.json({ id: 9, ...DATASHEET }, { status: 201 })
        : Response.json(
            { type: "about:blank", title: "Unprocessable", status: 422, code: refusal },
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

const placed = () => inspector().getByRole("button", { pressed: true }).all();

test("from an empty core an admin creates a module type, fills a roof face and paints a string", async () => {
  const core = emptyCore();

  await opened(core);
  await page.getByRole("button", { name: "Einfamilienhaus mit Satteldach" }).click();

  await drill("Module", SOUTH, "Neuer Modultyp");
  await datasheet();
  await inspector().getByRole("button", { name: "Modultyp anlegen" }).click();

  expect(core.posts).toEqual([DATASHEET]);

  // The new type lays the face's grid at once.
  await inspector().getByRole("button", { name: "Fläche füllen" }).click();
  await expect.poll(placed).toHaveLength(16);

  await drill("Module", "Szene", "Strings", "String hinzufügen");
  await drill("Strings", "Szene", "Module", SOUTH);
  await inspector().getByRole("radio", { name: "String 1 malen" }).click();
  await inspector().getByRole("button", { name: "Reihe 1, Spalte 1" }).click();

  await drill("Module", "Szene", "Strings");
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

test("a datasheet the core refuses shows its problem text and keeps what was entered", async () => {
  const core = emptyCore("layout.value");

  await opened(core);
  await page.getByRole("button", { name: "Einfamilienhaus mit Satteldach" }).click();

  await drill("Module", SOUTH, "Neuer Modultyp");
  await userEvent.fill(inspector().getByLabelText("Name"), MODULE.name);
  await inspector().getByRole("button", { name: "Modultyp anlegen" }).click();

  await expect
    .element(inspector().getByRole("alert"))
    .toHaveTextContent("Ein Wert liegt außerhalb seines physikalischen Bereichs.");
  await expect.element(inspector().getByLabelText("Name")).toHaveValue(MODULE.name);
  expect(core.posts).toHaveLength(1);
});
