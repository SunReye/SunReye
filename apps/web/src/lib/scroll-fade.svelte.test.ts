import { createRawSnippet } from "svelte";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../app.css";
import ResponsiveSheet from "../../../../packages/builder/src/components/responsive-sheet.svelte";
import Gallery from "./gallery/Gallery.svelte";
import { unfaded } from "./scroll-fade.harness.ts";

const root = document.documentElement;

const tall = createRawSnippet(() => ({ render: () => `<p style="height: 2000px">Inhalt</p>` }));

/** The elements a scroll-fade class masks right now. */
function masked(): Element[] {
  return [...document.querySelectorAll("[class*=scroll-fade]")].filter(
    (element) => getComputedStyle(element).maskImage !== "none",
  );
}

afterEach(() => {
  delete root.dataset["lowPower"];
});

test("every scroll container of the kit fades its edges, an open menu and select too", async () => {
  const screen = await render(Gallery);

  expect(unfaded()).toEqual([]);

  await screen.getByRole("button", { name: "Series" }).click();
  await expect.element(page.getByRole("menuitem", { name: "String east" })).toBeVisible();

  expect(unfaded()).toEqual([]);
});

test("an open select's list fades its edges", async () => {
  const screen = await render(Gallery);

  await screen.getByRole("combobox", { name: "Timezone" }).first().click();
  await expect
    .element(page.getByRole("listbox").getByRole("option", { name: "Europe/Vienna" }))
    .toBeVisible();

  expect(unfaded()).toEqual([]);
});

test("a form's dialog scrolls inside its glass: the surface keeps its edge, the scroller fades", async () => {
  await page.viewport(1280, 800);

  const shown = await render(ResponsiveSheet, { open: false, label: "Formular", children: tall });

  await shown.rerender({ open: true });

  const dialog = page.getByRole("dialog", { name: "Formular" });

  await expect.element(dialog).toBeVisible();
  expect(unfaded()).toEqual([]);
  // The glass itself is never masked: its border would fade with it.
  expect(getComputedStyle(dialog.element()).maskImage).toBe("none");
  expect(dialog.element().querySelector("p")?.closest("[class*=scroll-fade]")).not.toBeNull();
});

test("under the low-power switch nothing is masked", async () => {
  await render(Gallery);

  expect(masked().length).toBeGreaterThan(0);

  root.dataset["lowPower"] = "";

  expect(masked()).toEqual([]);
});
