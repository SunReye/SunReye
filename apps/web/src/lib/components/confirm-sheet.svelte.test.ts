// A destructive confirm (ADR 21): a dialog beside the rail, a drawer under the bar, with the same
// title, consequence, Cancel and action. A refusal stays in it; success closes it with a toast.
import { toast } from "svelte-sonner";
import { afterEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import type { Problem } from "../api/core.ts";
import { haptics } from "../haptics.ts";
import ConfirmSheet from "./confirm-sheet.svelte";

const TITLE = "Speicher entfernen";
const NOTE = "Sein Verlauf bleibt erhalten.";

const sheet = () => page.getByRole("dialog", { name: TITLE });
const action = () => sheet().getByRole("button", { name: "Entfernen", exact: true });

async function opened(answer?: Problem) {
  const onconfirm = vi.fn(() => Promise.resolve(answer));

  const shown = await render(ConfirmSheet, {
    open: false,
    title: TITLE,
    note: NOTE,
    action: "Entfernen",
    done: "Entfernt.",
    onconfirm,
  });

  await shown.rerender({ open: true });
  await expect.element(sheet()).toBeVisible();

  return onconfirm;
}

async function asksEverything(): Promise<void> {
  await expect.element(sheet().getByText(TITLE)).toBeVisible();
  await expect.element(sheet().getByText(NOTE)).toBeVisible();
  await expect.element(sheet().getByRole("button", { name: "Abbrechen" })).toBeVisible();
  await expect.element(action()).toBeVisible();
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("with a mouse at 1280 px a confirm is a dialog", async () => {
  await page.viewport(1280, 800);
  await opened();

  await expect.element(sheet()).toHaveAttribute("data-slot", "dialog-content");
  await asksEverything();
});

test("confirming closes the confirm and says so in a toast", async () => {
  const success = vi.spyOn(toast, "success");
  const felt = vi.spyOn(haptics, "success");
  const onconfirm = await opened();

  await action().click();

  await expect.element(sheet()).not.toBeInTheDocument();
  expect(onconfirm).toHaveBeenCalledOnce();
  expect(success).toHaveBeenCalledExactlyOnceWith("Entfernt.", {});
  expect(felt).toHaveBeenCalledOnce();
});

test("a refusal stays in the open confirm, beside the action, without a toast", async () => {
  const success = vi.spyOn(toast, "success");

  await opened({ problem: "connection.in-use" });
  await action().click();

  await expect
    .element(sheet().getByRole("alert"))
    .toHaveTextContent("Ein Gerät nutzt diese Verbindung noch.");
  await expect.element(action()).toBeVisible();
  expect(success).not.toHaveBeenCalled();
});

test("cancelling closes the confirm and does nothing", async () => {
  const onconfirm = await opened();

  await sheet().getByRole("button", { name: "Abbrechen" }).click();

  await expect.element(sheet()).not.toBeInTheDocument();
  expect(onconfirm).not.toHaveBeenCalled();
});

// Last: touch emulation cannot be undone (pointer stays `none`).
test("on touch at 390 px the same confirm is a drawer", async () => {
  await page.viewport(390, 844);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true });

  try {
    const success = vi.spyOn(toast, "success");

    await opened();

    await expect.element(sheet()).toHaveAttribute("data-slot", "drawer-content");
    await asksEverything();
    await action().click();

    await expect.element(sheet()).not.toBeInTheDocument();
    expect(success).toHaveBeenCalledExactlyOnceWith("Entfernt.", {});
  } finally {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
});
