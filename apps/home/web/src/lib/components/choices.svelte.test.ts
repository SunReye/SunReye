// The kit's controls that choose tick `selection` on a change the user makes, and only then
// (ADR 21 "One behaviour, one component").
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { haptics } from "@sunreye/ui/haptics";
import Choices from "./choices.harness.svelte";
import Probe from "./select.harness.svelte";
import { Toggle } from "@sunreye/ui/toggle";

afterEach(() => {
  vi.restoreAllMocks();
});

const KINDS = [
  ["toggle-group", "radio", "aria-checked"],
  ["radio-group", "radio", "aria-checked"],
  ["menu", "menuitemradio", "aria-checked"],
  ["select", "option", "aria-selected"],
] as const;

/** The user picks the chosen option, then another; then the value is set from outside. */
async function pick([kind, role, chosen]: (typeof KINDS)[number]): Promise<void> {
  const selection = vi.spyOn(haptics, "selection");
  const screen = kind === "select" ? await render(Probe) : await render(Choices, { kind });

  await page.getByRole(role, { name: "a" }).click();
  expect(selection, `${kind}: the chosen option`).not.toHaveBeenCalled();

  if (kind === "select") await page.getByRole("combobox", { name: "Probe" }).click();

  await page.getByRole(role, { name: "b" }).click();
  expect(selection, `${kind}: another option`).toHaveBeenCalledOnce();

  await screen.rerender({ value: "c" });
  await expect.element(page.getByRole(role, { name: "c" })).toHaveAttribute(chosen, "true");
  expect(selection, `${kind}: set from outside`).toHaveBeenCalledOnce();

  await screen.unmount();
  selection.mockRestore();
}

/** A disclosure opened by the user, then from outside. */
async function disclose(): Promise<void> {
  const selection = vi.spyOn(haptics, "selection");
  const screen = await render(Choices, { kind: "collapsible" });

  await page.getByRole("button", { name: "Probe" }).click();
  await expect.element(page.getByText("Inside")).toBeVisible();
  expect(selection, "disclosure: opened").toHaveBeenCalledOnce();

  await screen.rerender({ open: false });
  await screen.rerender({ open: true });
  expect(selection, "disclosure: from outside").toHaveBeenCalledOnce();

  await screen.unmount();
  selection.mockRestore();
}

/** A toggle pressed by the user, then from outside. */
async function press(): Promise<void> {
  const selection = vi.spyOn(haptics, "selection");
  const screen = await render(Toggle, { "aria-label": "Probe", pressed: false });

  await page.getByRole("button", { name: "Probe" }).click();
  await expect
    .element(page.getByRole("button", { name: "Probe" }))
    .toHaveAttribute("aria-pressed", "true");
  expect(selection, "toggle: pressed").toHaveBeenCalledOnce();

  await screen.rerender({ pressed: false });
  expect(selection, "toggle: from outside").toHaveBeenCalledOnce();
}

// One case for every control: each mount costs the browser more than its checks.
test("each control that chooses ticks once for the user's change, never for the chosen option or a value set from outside", async () => {
  // oxlint-disable-next-line no-await-in-loop -- one control at a time.
  for (const kind of KINDS) await pick(kind);

  await disclose();
  await press();
});
