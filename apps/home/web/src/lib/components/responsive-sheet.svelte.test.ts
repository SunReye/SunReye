import { createRawSnippet } from "svelte";
import { expect, test } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import ResponsiveSheet from "../../../../../../packages/builder/src/components/responsive-sheet.svelte";

const form = createRawSnippet(() => ({ render: () => `<label>Name <input /></label>` }));

const sheet = () => page.getByRole("dialog", { name: "Formular" });

async function opened(): Promise<void> {
  const shown = await render(ResponsiveSheet, { open: false, label: "Formular", children: form });

  await shown.rerender({ open: true });
  await expect.element(sheet()).toBeVisible();
}

test("with a mouse at 1280 px a form is a dialog", async () => {
  await page.viewport(1280, 800);
  await opened();

  await expect.element(sheet()).toHaveAttribute("data-slot", "dialog-content");
  await expect.element(sheet().getByRole("textbox", { name: "Name" })).toBeVisible();
});

// Last: touch emulation cannot be undone (pointer stays `none`).
test("on touch at 390 px the same form is a drawer", async () => {
  await page.viewport(390, 844);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true });

  try {
    await opened();

    await expect.element(sheet()).toHaveAttribute("data-slot", "drawer-content");
    await expect.element(sheet().getByRole("textbox", { name: "Name" })).toBeVisible();
  } finally {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
});
