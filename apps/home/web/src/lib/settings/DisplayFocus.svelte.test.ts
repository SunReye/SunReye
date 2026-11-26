import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import DisplaySettings from "./DisplaySettings.svelte";

afterEach(() => {
  localStorage.clear();
});

test("tilt-shift and depth of field are off by default and kept independently", async () => {
  const screen = await render(DisplaySettings);
  const tilt = screen.getByRole("switch", { name: "Tilt-Shift" });
  const depth = screen.getByRole("switch", { name: "Tiefenschärfe" });

  await expect.element(tilt).not.toBeChecked();
  await expect.element(depth).not.toBeChecked();
  await userEvent.click(tilt);
  await expect.element(tilt).toBeChecked();
  await expect.element(depth).not.toBeChecked();
  expect(localStorage.getItem("sunreye.tilt-shift")).toBe("on");

  await userEvent.click(depth);
  await expect.element(depth).toBeChecked();
  await userEvent.click(tilt);
  await expect.element(tilt).not.toBeChecked();
  await expect.element(depth).toBeChecked();
  expect(localStorage.getItem("sunreye.tilt-shift")).toBe("off");
  expect(localStorage.getItem("sunreye.depth-of-field")).toBe("on");
  await userEvent.click(depth);
});
