import { createRawSnippet } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { haptics } from "../haptics.ts";
import { motion } from "../motion/tier.svelte.ts";
import DrawerSheet from "./drawer-sheet.svelte";
import { held, press } from "./drawer.harness.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  motion.lowPower = false;
});

const body = createRawSnippet(() => ({ render: () => `<p style="height: 400px">Inhalt</p>` }));

/** Opens the drawer as a tap would: one mounted open never plays its entrance. */
async function opened() {
  const shown = await render(DrawerSheet, { open: false, label: "Blatt", children: body });

  await shown.rerender({ open: true });
  await expect.element(sheet()).toBeVisible();

  return shown;
}

const sheet = () => page.getByRole("dialog", { name: "Blatt" });

/** The drawer's drag offset in px, as the finger or its settle left it. */
function lift(): number {
  const { transform } = getComputedStyle(sheet().element());

  return transform === "none" ? 0 : new DOMMatrix(transform).m42;
}

test("it is a drawer from the bottom, without snap points, entering in about 350 ms", async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  await opened();

  await expect.element(sheet()).toHaveAttribute("data-vaul-drawer-direction", "bottom");
  await expect.element(sheet()).toHaveAttribute("data-vaul-snap-points", "false");

  const entering = getComputedStyle(sheet().element());

  expect(entering.animationName).toBe("slideFromBottom");
  expect(entering.animationDuration).toBe("0.35s");
});

test("the drawer follows the finger and settles back open with a soft tap when let go early", async () => {
  const soft = vi.spyOn(haptics, "soft");

  await opened();

  const release = await press(sheet().element(), 40);

  // Held still: a slow release is no fling.
  held(release);

  await expect.poll(lift).toBe(0);
  await expect.element(sheet()).toBeVisible();
  expect(soft).toHaveBeenCalledOnce();
});

test("a pull down closes the drawer with a soft tap", async () => {
  const soft = vi.spyOn(haptics, "soft");
  await opened();

  const release = await press(sheet().element(), 300);

  release();

  await expect.element(sheet()).not.toBeInTheDocument();
  expect(soft).toHaveBeenCalledOnce();
});

test("the scrim dims the page without blurring it", async () => {
  await opened();
  await expect.element(sheet()).toBeVisible();

  const scrim = document.querySelector<HTMLElement>('[data-slot="drawer-overlay"]');

  expect(scrim && getComputedStyle(scrim).backdropFilter).toBe("none");
});

test("under low power the drawer opens, settles and closes without a frame", async () => {
  motion.lowPower = true;

  const { rerender } = await opened();

  expect(getComputedStyle(sheet().element()).animationName).toBe("none");

  const release = await press(sheet().element(), 40);

  // No frame ever comes: only a drawer that does not animate can land.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  held(release);

  await expect.poll(lift).toBe(0);
  vi.unstubAllGlobals();

  await rerender({ open: false });
  await expect.element(sheet()).not.toBeInTheDocument();
});
