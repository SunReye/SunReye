// The kit's controls that choose tick `selection` on a change the user makes, and only then
// (ADR 21 "One behaviour, one component").
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { haptics } from "../haptics.ts";
import Choices from "./choices.harness.svelte";
import { Toggle } from "./ui/toggle/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const KINDS = [
  ["toggle-group", "radio"],
  ["radio-group", "radio"],
  ["menu", "menuitemradio"],
] as const;

test.each(KINDS)("a %s ticks once when the user picks another option", async (kind, role) => {
  const selection = vi.spyOn(haptics, "selection");

  await render(Choices, { kind });
  await page.getByRole(role, { name: "b" }).click();

  expect(selection).toHaveBeenCalledOnce();
});

test.each(KINDS)("a %s stays still when the user picks the chosen option", async (kind, role) => {
  const selection = vi.spyOn(haptics, "selection");

  await render(Choices, { kind });
  await page.getByRole(role, { name: "a" }).click();

  expect(selection).not.toHaveBeenCalled();
});

test.each(KINDS)("a %s set from outside is silent", async (kind, role) => {
  const selection = vi.spyOn(haptics, "selection");
  const screen = await render(Choices, { kind });

  await screen.rerender({ value: "c" });
  await expect.element(page.getByRole(role, { name: "c" })).toHaveAttribute("aria-checked", "true");

  expect(selection).not.toHaveBeenCalled();
});

test("a disclosure ticks once when the user opens it, and not when it is opened from outside", async () => {
  const selection = vi.spyOn(haptics, "selection");
  const screen = await render(Choices, { kind: "collapsible" });

  await page.getByRole("button", { name: "Probe" }).click();
  await expect.element(page.getByText("Inside")).toBeVisible();

  expect(selection).toHaveBeenCalledOnce();

  await screen.rerender({ open: false });
  await screen.rerender({ open: true });

  expect(selection).toHaveBeenCalledOnce();
});

test("a toggle ticks once when the user presses it, and not when pressed from outside", async () => {
  const selection = vi.spyOn(haptics, "selection");
  const screen = await render(Toggle, { "aria-label": "Probe", pressed: false });

  await page.getByRole("button", { name: "Probe" }).click();
  await expect
    .element(page.getByRole("button", { name: "Probe" }))
    .toHaveAttribute("aria-pressed", "true");

  expect(selection).toHaveBeenCalledOnce();

  await screen.rerender({ pressed: false });

  expect(selection).toHaveBeenCalledOnce();
});
