import "../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Builder from "../../../../../packages/builder/src/builder/Builder.svelte";
import { unfaded } from "../scroll-fade.harness.ts";
import {
  choose,
  desk,
  DEVICES,
  drill,
  enter,
  hosted,
  house,
  inspector,
  MODULE,
  phone,
  pv,
  starts,
  tap,
  testCore,
  undesk,
} from "./builder.harness.ts";
import { saveFrom } from "./moment.harness.ts";
import type { Scene } from "../../../../../packages/builder/src/builder/pv.ts";

// A block's overhang and colours, and chimneys on its roof (ADR 20), from the inspector.

beforeEach(desk);

afterEach(async () => {
  await undesk();
  await page.viewport(1280, 900);
});

/** The scene the core was last sent. */
function sent(puts: readonly unknown[]): Scene {
  const last: unknown = puts.at(-1);

  if (!(last instanceof Object) || !("scene" in last)) throw new TypeError("no scene sent");

  // SAFETY: the builder sends only `body()`'s LayoutChange, whose scene is the draft's.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the builder's own change.
  return last.scene as Scene;
}

test("roof and wall colours are saved with the block, and the crate paints its faces in them", async () => {
  const core = testCore();

  await render(Builder, {
    pv,
    ...hosted(core),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Gebäude", "Baukörper 1");
  await inspector()
    .getByRole("group", { name: "Dachfarbe" })
    .getByRole("radio", { name: "Ziegelrot" })
    .click();
  await inspector()
    .getByRole("group", { name: "Wandfarbe" })
    .getByRole("radio", { name: "Creme" })
    .click();
  await expect
    .element(
      inspector()
        .getByRole("group", { name: "Dachfarbe" })
        .getByRole("radio", { name: "Ziegelrot" }),
    )
    .toBeChecked();
  await saveFrom("2026-11-01");

  await expect.poll(() => core.puts.length).toBe(1);

  const [block] = sent(core.puts).blocks;

  expect([block?.roofColour, block?.wallColour]).toEqual(["#9c4a32", "#e9dcc0"]);

  const faces = pv.geometry(sent(core.puts)).faces;

  expect(faces.filter((f) => f.surface === "roof").map((f) => f.colour)).toEqual([
    "#9c4a32",
    "#9c4a32",
  ]);
  expect(new Set(faces.filter((f) => f.surface === "wall").map((f) => f.colour))).toEqual(
    new Set(["#e9dcc0"]),
  );
});

test("a block's overhang is edited in metres; a flat roof has eaves only", async () => {
  const core = testCore();

  await render(Builder, {
    pv,
    ...hosted(core),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Gebäude", "Baukörper 1");
  await enter("Traufüberstand (m)", "0,6");
  await enter("Ortgangüberstand (m)", "0,2");
  await saveFrom("2026-11-01");

  await expect.poll(() => core.puts.length).toBe(1);
  expect(sent(core.puts).blocks[0]?.overhang).toEqual({ eave: 0.6, verge: 0.2 });

  await choose("Dach", "Flachdach");
  await expect
    .element(inspector().getByRole("button", { name: starts("Traufüberstand (m)") }))
    .toBeVisible();
  expect(
    inspector()
      .getByRole("button", { name: starts("Ortgangüberstand (m)") })
      .query(),
  ).toBeNull();
});

test("a chimney is added on a roof face, sized and saved, and the crate draws it", async () => {
  const core = testCore();

  await render(Builder, {
    pv,
    ...hosted(core),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Gebäude", "Schornstein hinzufügen");
  await expect.element(inspector().getByRole("heading", { name: "Schornstein 1" })).toBeVisible();
  await enter("Höhe (m)", "1,5");
  await saveFrom("2026-11-01");

  await expect.poll(() => core.puts.length).toBe(1);

  const scene = sent(core.puts);
  const [chimney] = scene.chimneys ?? [];

  expect(chimney).toMatchObject({ block: 0, height: 1.5, width: 0.6, depth: 0.6 });

  expect(pv.geometry(scene).faces.filter((f) => f.surface === "chimney")).toHaveLength(5);
});

test("on a phone, + adds a chimney and the sheet opens on it", async () => {
  await phone();
  await render(Builder, {
    pv,
    ...hosted(testCore()),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await tap(
    page.getByRole("toolbar", { name: "Werkzeuge" }).getByRole("button", { name: "Hinzufügen" }),
  );
  await expect.element(page.getByRole("button", { name: "Schornstein hinzufügen" })).toBeVisible();
  expect(unfaded()).toEqual([]);
  await tap(page.getByRole("button", { name: "Schornstein hinzufügen" }));

  const sheet = page.getByRole("region", { name: "Szene bearbeiten" });

  await expect.element(sheet.getByRole("heading", { name: "Schornstein 1" })).toBeVisible();
  await expect.element(sheet.getByRole("button", { name: starts("Dachfläche") })).toBeVisible();
});
