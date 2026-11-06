import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import * as m from "$lib/paraglide/messages";
import GuardDialog from "./guard-dialog.svelte";

// `current-2.x`'s held register (fixtures/oracle/archives/current-2.x/config.json, `automationState`) and the
// sha256 the core answers its upload with (`sha256sum archive.tar.gz`).
const SHA256 = "cc05db473ae491d3495ed10ad78c23625b85931404c2d347742e428e06a4802d";
const GUARDED = {
  sha256: SHA256,
  held: [
    { key: "1:peak-shaving", value: 60, capturedAt: "2026-05-01T10:00:00.000Z" },
    { key: "2:evcc-boost", value: "pv", capturedAt: "2026-05-01T10:05:00.000Z" },
  ],
};

/** Two frames: a dialog that were closing would have left `data-state="open"` by now. */
const frames = async () => {
  for (let i = 0; i < 2; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};

function open(guarded = GUARDED, busy = false) {
  const onContinue = vi.fn();
  const onCancel = vi.fn();
  render(GuardDialog, { guarded, busy, onContinue, onCancel });
  return { onContinue, onCancel };
}

const confirmation = () => page.getByRole("checkbox", { name: m.import_guard_confirm() });
const proceed = () => page.getByRole("button", { name: m.action_continue() });
const cancel = () => page.getByRole("button", { name: m.action_cancel() });

test("the tick box has a 44px touch target", async () => {
  open();
  const after = getComputedStyle(confirmation().element(), "::after");
  expect(Number.parseFloat(after.width)).toBeGreaterThanOrEqual(44);
  expect(Number.parseFloat(after.height)).toBeGreaterThanOrEqual(44);
});

test("lists every saved value with its holder and when it was saved", async () => {
  open();
  const row = (holder: string) => page.getByRole("row").filter({ hasText: holder });
  await expect
    .element(row("1:peak-shaving"))
    .toHaveTextContent("1:peak-shaving 60 2026-05-01T10:00:00.000Z");
  await expect
    .element(row("2:evcc-boost"))
    .toHaveTextContent("2:evcc-boost pv 2026-05-01T10:05:00.000Z");
});

test("names the case of an archive that holds no register value", async () => {
  open({ sha256: SHA256, held: [] });
  await expect.element(page.getByText(m.import_guard_none())).toBeVisible();
});

test("Continue stays disabled until the user ticks that automation was switched off, and again when they untick", async () => {
  open();
  await expect.element(proceed()).toBeDisabled();
  await confirmation().click();
  await expect.element(proceed()).toBeEnabled();
  await confirmation().click();
  await expect.element(proceed()).toBeDisabled();
});

test("Continue confirms the sha256 of the upload the guard held, once", async () => {
  const { onContinue, onCancel } = open();
  await confirmation().click();
  await proceed().click();
  expect(onContinue).toHaveBeenCalledExactlyOnceWith(SHA256);
  expect(onCancel).not.toHaveBeenCalled();
});

test("Cancel imports nothing", async () => {
  const { onContinue, onCancel } = open();
  await confirmation().click();
  await cancel().click();
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onContinue).not.toHaveBeenCalled();
});

test("Escape does not dismiss it, and neither confirms nor cancels", async () => {
  const { onContinue, onCancel } = open();
  await userEvent.keyboard("{Escape}");
  await frames();
  await expect.element(page.getByRole("dialog")).toHaveAttribute("data-state", "open");
  await expect.element(confirmation()).not.toBeChecked();
  expect(onContinue).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
});

test("a click on the backdrop does not dismiss it, and neither confirms nor cancels", async () => {
  const { onContinue, onCancel } = open();
  const overlay = document.querySelector('[data-slot="dialog-overlay"]')!;
  await page.elementLocator(overlay).click({ position: { x: 4, y: 4 } });
  await frames();
  await expect.element(page.getByRole("dialog")).toHaveAttribute("data-state", "open");
  expect(onContinue).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
});

test("offers no close control besides Cancel", async () => {
  open();
  await expect.element(page.getByRole("button", { name: "Close" })).not.toBeInTheDocument();
});

test("while the import runs neither button can be pressed again", async () => {
  open(GUARDED, true);
  await expect.element(proceed()).toBeDisabled();
  await expect.element(cancel()).toBeDisabled();
});

test("renders nothing without a guard", async () => {
  render(GuardDialog, { guarded: null, busy: false, onContinue: vi.fn(), onCancel: vi.fn() });
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});
