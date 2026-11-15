import { createRawSnippet } from "svelte";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import FormField from "./form-field.svelte";
import ProblemAlert from "./problem-alert.svelte";
import StatusLine from "./status-line.svelte";
import TextField from "./text-field.svelte";

const text = createRawSnippet(() => ({ render: () => `<span>Seit 3 min keine Werte</span>` }));

const control = createRawSnippet<[{ id: string; invalid: boolean }]>((field) => ({
  render: () => `<input id="${field().id}" aria-invalid="${field().invalid}" />`,
}));

test("a problem alert says a core problem in the app's words", async () => {
  const screen = await render(ProblemAlert, { problem: "request.route" });

  await expect.element(screen.getByRole("alert")).toHaveTextContent("Diese Adresse gibt es nicht.");
});

test("a problem alert says a text of the app's own, and nothing without either", async () => {
  const screen = await render(ProblemAlert, { text: "Die Passwörter stimmen nicht überein." });

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Die Passwörter stimmen nicht überein.");

  await screen.rerender({ text: undefined });

  expect(screen.getByRole("alert").query()).toBeNull();
});

test("a status line is a status as a warning and an alert when destructive", async () => {
  const screen = await render(StatusLine, { tone: "warning", children: text });

  await expect.element(screen.getByRole("status")).toHaveTextContent("Seit 3 min keine Werte");

  await screen.rerender({ tone: "destructive", children: text });

  await expect.element(screen.getByRole("alert")).toHaveTextContent("Seit 3 min keine Werte");
});

test("a form field names its control and says its hint", async () => {
  const screen = await render(FormField, {
    label: "Modbus-Adresse",
    hint: "0 bis 247",
    children: control,
  });

  const input = screen.getByLabelText("Modbus-Adresse");

  await expect.element(input).toHaveAttribute("aria-invalid", "false");
  await expect.element(screen.getByText("0 bis 247")).toBeVisible();
});

test("a form field with an error marks its control invalid and says the error", async () => {
  const screen = await render(FormField, {
    label: "Modbus-Adresse",
    error: "Zu groß.",
    children: control,
  });

  await expect
    .element(screen.getByLabelText("Modbus-Adresse"))
    .toHaveAttribute("aria-invalid", "true");
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Zu groß.");
});

test("a text field is a named input that holds what is typed, with its hint", async () => {
  const screen = await render(TextField, { label: "Host", hint: "Im eigenen Netz", value: "" });
  const input = screen.getByLabelText("Host");

  await input.fill("192.168.1.40");

  await expect.element(input).toHaveValue("192.168.1.40");
  await expect.element(screen.getByText("Im eigenen Netz")).toBeVisible();
});

test("a text field with an error is invalid and says the error", async () => {
  const screen = await render(TextField, { label: "Host", error: "Nicht erreichbar.", value: "x" });

  await expect.element(screen.getByLabelText("Host")).toHaveAttribute("aria-invalid", "true");
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Nicht erreichbar.");
});
