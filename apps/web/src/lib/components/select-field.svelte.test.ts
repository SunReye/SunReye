import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
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
