import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { frameLimit } from "../scene/frame-limit.svelte.ts";
import { FRAME_LIMIT } from "../scene/frame-limit.ts";
import DisplaySettings from "./DisplaySettings.svelte";

// Settings › Display's Bildrate row (ADR 21 "Frame limit").

afterEach(() => {
  frameLimit.choice = "unlimited";
  localStorage.clear();
});

async function display() {
  const screen = await render(DisplaySettings);

  return { screen, choices: screen.getByRole("group", { name: "Bildrate" }) };
}

test("Bildrate starts on Unbegrenzt and says what it limits", async () => {
  const { screen, choices } = await display();

  await expect.element(choices.getByRole("radio", { name: "Unbegrenzt" })).toBeChecked();
  await expect.element(choices.getByRole("radio", { name: "60" })).not.toBeChecked();
  await expect.element(choices.getByRole("radio", { name: "30" })).not.toBeChecked();
  await expect
    .element(screen.getByText("Wie viele Bilder pro Sekunde das 3D-Haus höchstens zeichnet."))
    .toBeVisible();
});

test("a chosen limit holds the scene's frames and is kept per browser", async () => {
  const { choices } = await display();

  await userEvent.click(choices.getByRole("radio", { name: "30" }));

  expect(frameLimit.choice).toBe("30");
  expect(localStorage.getItem(FRAME_LIMIT)).toBe("30");
  await expect.element(choices.getByRole("radio", { name: "30" })).toBeChecked();

  // The chosen segment pressed again stays chosen.
  await userEvent.click(choices.getByRole("radio", { name: "30" }));
  expect(frameLimit.choice).toBe("30");

  await userEvent.click(choices.getByRole("radio", { name: "Unbegrenzt" }));
  expect(frameLimit.choice).toBe("unlimited");
  expect(localStorage.getItem(FRAME_LIMIT)).toBe("unlimited");
});
