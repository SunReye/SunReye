// Drawer or popover is one decision, by input (ADR 21): every picker asks the shell's input module,
// so a form on a phone is all drawers and with a mouse all popovers.
import { expect, test } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import ComboboxField from "./combobox-field.svelte";
import DateField from "./date-field.svelte";
import SelectField from "./select-field.svelte";
import { editable } from "./value-editor/editable.ts";
import ValueEditor from "./value-editor/value-editor.svelte";

const OPTIONS = [
  { value: "modbus-tcp", label: "Modbus TCP" },
  { value: "mqtt", label: "MQTT" },
];

const CHARGE = editable({
  key: "battery.max_charge_current",
  name: "Max. Ladestrom",
  unit: "A",
  range: { min: 0, max: 240 },
  step: 1,
});

/** The drawer on screen, if any. */
const drawer = () => document.querySelector('[data-slot="drawer-content"]');

/** Each picker, rendered and opened, until its content shows. */
const PICKERS = [
  [
    "select field",
    async () => {
      const screen = await render(SelectField, {
        label: "Transport",
        value: "mqtt",
        options: OPTIONS,
      });

      await screen.getByRole("combobox", { name: "Transport" }).click();
      await expect.element(page.getByRole("option", { name: "Modbus TCP" })).toBeVisible();
    },
  ],
  [
    "date field",
    async () => {
      const screen = await render(DateField, {
        label: "Tag",
        value: "2026-11-13",
        onchange: () => null,
      });

      await screen.getByRole("button", { name: "Tag" }).click();
      await expect.element(page.getByRole("grid")).toBeVisible();
    },
  ],
  [
    "combobox field",
    async () => {
      const screen = await render(ComboboxField, {
        value: "Europe/Berlin",
        options: ["Europe/Berlin", "Europe/Paris"],
        id: "zone",
        search: "Suchen",
        none: "Nichts",
      });

      await screen.getByRole("combobox").click();
      await expect.element(page.getByPlaceholder("Suchen")).toBeVisible();
    },
  ],
  [
    "value editor",
    async () => {
      const anchor = document.createElement("div");
      anchor.style.cssText = "position: fixed; left: 0; top: 0; width: 8px; height: 8px";
      document.body.append(anchor);

      await render(ValueEditor, {
        props: {
          key: "k",
          edit: CHARGE,
          current: 100,
          anchor,
          open: true,
          onapply: () => Promise.resolve({ kind: "confirmed" as const }),
        },
      });
      await expect.element(page.getByRole("spinbutton")).toBeVisible();
    },
  ],
] as const;

test.each(PICKERS)("with a mouse a %s is a popover", async (_name, open) => {
  await page.viewport(1280, 800);
  await open();

  expect(drawer()).toBeNull();
});

// Last: touch emulation cannot be undone (pointer stays `none`).
test.each(PICKERS)("on a phone's touch a %s is a drawer", async (_name, open) => {
  await page.viewport(390, 844);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true });

  try {
    await open();

    expect(drawer()).not.toBeNull();
  } finally {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
});
