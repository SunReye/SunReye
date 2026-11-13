import { createRawSnippet } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { motion } from "../motion/tier.svelte.ts";
import BottomSheet from "./bottom-sheet.svelte";

afterEach(() => {
  vi.unstubAllGlobals();
  motion.lowPower = false;
});

const body = createRawSnippet(() => ({ render: () => `<p style="height: 400px">Inhalt</p>` }));

test("with low power on the sheet lands back without a frame", async () => {
  motion.lowPower = true;
  await render(BottomSheet, { open: true, label: "Blatt", children: body });

  const sheet = page.getByRole("dialog").element();

  if (!(sheet instanceof HTMLElement)) throw new TypeError("no sheet");

  await expect.element(page.getByText("Inhalt")).toBeVisible();
  // A synthetic pointer has no capture to take.
  sheet.setPointerCapture = () => {};

  const box = sheet.getBoundingClientRect();

  const at = (type: string, clientY: number) =>
    sheet.dispatchEvent(
      new PointerEvent(type, { clientX: box.left + 20, clientY, pointerId: 3, bubbles: true }),
    );

  at("pointerdown", box.top + 10);
  at("pointermove", box.top + 60);
  await expect.poll(() => sheet.style.translate).toBe("0px 50px");

  // No frame ever comes: only a sheet that does not animate can land.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  at("pointerup", box.top + 60);

  await expect.poll(() => sheet.style.translate).toBe("0px");
});
