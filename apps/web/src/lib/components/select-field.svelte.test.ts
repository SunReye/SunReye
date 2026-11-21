import { createRawSnippet } from "svelte";
import { expect, test } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { closed } from "../motion/animations.harness.ts";
import SelectField from "./select-field.svelte";

const OPTIONS = [
  { value: "modbus-tcp", label: "Modbus TCP" },
  { value: "mqtt", label: "MQTT" },
];

test("a field shows its label above a full-width trigger, and gives back the pick", async () => {
  const picked: string[] = [];

  const screen = await render(SelectField, {
    field: true,
    label: "Transport",
    value: "modbus-tcp",
    options: OPTIONS,
    onchange: (value: string) => {
      picked.push(value);
    },
  });

  const trigger = screen.getByLabelText("Transport");
  const label = screen.getByText("Transport", { exact: true });

  await expect.element(trigger).toHaveTextContent("Modbus TCP");
  await expect.element(label).toBeVisible();

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- vitest's own.
  const [above, below] = [label, trigger].map((part) => part.element().getBoundingClientRect());

  expect(above?.bottom).toBeLessThanOrEqual(below?.top ?? 0);
  expect(below?.width).toBe(screen.container.getBoundingClientRect().width);

  await trigger.click();
  await page.getByRole("option", { name: "MQTT" }).click();

  expect(picked).toEqual(["mqtt"]);
  await expect.element(trigger).toHaveTextContent("MQTT");
});

test("a value no option has shows as itself", async () => {
  const screen = await render(SelectField, { label: "Transport", value: "http", options: OPTIONS });

  await expect
    .element(screen.getByRole("combobox", { name: "Transport" }))
    .toHaveTextContent("http");
});

const LINES = [
  { value: "total", label: "Gesamt" },
  { value: "mppt1", label: "Ganzer Eingang", group: "MPPT 1" },
  { value: "south", label: "Süd ≈", group: "MPPT 1" },
  { value: "mppt2", label: "Ganzer Eingang", group: "MPPT 2" },
];

test("options under a heading are its group, and a note stands at the list's foot", async () => {
  const screen = await render(SelectField, {
    label: "Linie",
    value: "total",
    options: LINES,
    note: "≈ geschätzt",
  });

  await screen.getByRole("combobox", { name: "Linie" }).click();

  const list = page.getByRole("listbox");

  await expect
    .element(list.getByRole("group", { name: "MPPT 1" }).getByRole("option", { name: "Süd ≈" }))
    .toBeVisible();
  await expect
    .element(list.getByRole("group", { name: "MPPT 2" }).getByRole("option"))
    .toHaveTextContent("Ganzer Eingang");
  await expect.element(page.getByText("≈ geschätzt")).toBeVisible();
});

test("an option draws as its caller's row, and a disabled field does not open", async () => {
  const item = createRawSnippet((option: () => { label: string }) => ({
    render: () => `<span data-row>${option().label}!</span>`,
  }));

  const screen = await render(SelectField, {
    label: "Transport",
    value: "mqtt",
    options: OPTIONS,
    item,
  });

  await screen.getByRole("combobox", { name: "Transport" }).click();
  await expect.element(page.getByRole("option", { name: "Modbus TCP!" })).toBeVisible();

  await screen.unmount();

  const off = await render(SelectField, {
    label: "Transport",
    value: "mqtt",
    options: OPTIONS,
    disabled: true,
  });

  await expect.element(off.getByRole("combobox", { name: "Transport" })).toBeDisabled();
});

// Last: touch emulation cannot be undone (pointer stays `none`).
test("on touch the list is a drawer: a pick gives it back and closes the drawer", async () => {
  await page.viewport(390, 844);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true });

  try {
    const picked: string[] = [];

    const screen = await render(SelectField, {
      label: "Transport",
      value: "modbus-tcp",
      options: OPTIONS,
      onchange: (value: string) => {
        picked.push(value);
      },
    });

    await screen.getByRole("combobox", { name: "Transport" }).click();

    const list = page.getByRole("listbox", { name: "Transport" });

    await expect
      .element(list.getByRole("option", { name: "Modbus TCP" }))
      .toHaveAttribute("aria-selected", "true");
    await list.getByRole("option", { name: "MQTT" }).click();

    expect(picked).toEqual(["mqtt"]);
    await closed(list);
    await expect
      .element(screen.getByRole("combobox", { name: "Transport" }))
      .toHaveTextContent("MQTT");
  } finally {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
});

test("on touch the drawer keeps the groups and the note", async () => {
  await page.viewport(390, 844);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true });

  try {
    const screen = await render(SelectField, {
      label: "Linie",
      value: "total",
      options: LINES,
      note: "≈ geschätzt",
    });

    await screen.getByRole("combobox", { name: "Linie" }).click();

    const list = page.getByRole("listbox", { name: "Linie" });

    await expect
      .element(list.getByRole("group", { name: "MPPT 1" }).getByRole("option", { name: "Süd ≈" }))
      .toBeVisible();
    await expect.element(page.getByText("≈ geschätzt")).toBeVisible();
  } finally {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
});
