import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { HAPTICS } from "../../haptics.ts";
import { motion } from "../../motion/tier.svelte.ts";
import Harness from "./drill-in.harness.svelte";

let vibrate: ReturnType<typeof vi.fn<() => boolean>>;

beforeEach(() => {
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  localStorage.setItem(HAPTICS, "on");
});

afterEach(async () => {
  localStorage.removeItem(HAPTICS);
  motion.lowPower = false;
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  await page.viewport(414, 896);
});

function frame(): Promise<number> {
  return new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
}

function child(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-drill=page]");
}

/** How far the child page sits right of its place, in % of the width; 100 when it is gone. */
function offset(): number {
  const transform = child()?.style.transform;

  return transform === undefined || transform === ""
    ? 100
    : Number(/translateX\(([-\d.]+)%\)/u.exec(transform)?.[1]);
}

async function until(done: () => boolean): Promise<void> {
  await expect.poll(done, { timeout: 2000 }).toBe(true);
}

test("tapping a row slides its page in and the commit plays soft", async () => {
  const screen = await render(Harness);
  await screen.getByRole("button", { name: /Batterie/u }).click();

  await until(() => offset() === 0);
  await expect.element(screen.getByText("Seite Batterie")).toBeVisible();
  expect(vibrate).toHaveBeenCalledOnce();
});

test("browser back slides the page out again", async () => {
  const screen = await render(Harness);
  await screen.getByRole("button", { name: /Batterie/u }).click();
  await until(() => offset() === 0);

  history.back();

  await until(() => child() === null);
  await expect.element(screen.getByRole("button", { name: /Netz/u })).toBeVisible();
});

test("the back button goes back", async () => {
  const screen = await render(Harness, { initial: "battery" });
  await screen.getByRole("button", { name: "Steuerung" }).click();

  await until(() => child() === null);
});

test("a reversed slide continues from where it is", async () => {
  const screen = await render(Harness);
  await screen.getByRole("button", { name: /Batterie/u }).click();
  await until(() => offset() < 70);
  const before = offset();

  history.back();
  await frame();

  // Frame length varies under load, so assert direction, not distance: no snap
  // back in (a restart) and no snap out (a jump to gone).
  expect(offset()).toBeGreaterThan(before - 20);
  expect(child()).not.toBeNull();
  await until(() => child() === null);
});

test("only transform and opacity animate", async () => {
  const screen = await render(Harness);
  const animated = new Set<string>();

  await screen.getByRole("button", { name: /Batterie/u }).click();
  // Every inline style set on the way, sampled as the slide runs.
  await until(() => {
    for (const element of document.querySelectorAll<HTMLElement>("[data-drill=box] *")) {
      for (const name of element.style) animated.add(name);
    }

    return offset() === 0;
  });

  expect([...animated].toSorted()).toEqual(["opacity", "transform"]);
});

test.each([
  [
    "reduced motion",
    async () => {
      await cdp().send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
    },
  ],
  [
    "the low-power switch",
    async () => {
      motion.lowPower = true;
      await Promise.resolve();
    },
  ],
])("%s makes the slide instant", async (_, still) => {
  await still();

  const screen = await render(Harness);
  await screen.getByRole("button", { name: /Batterie/u }).click();
  await frame();

  expect(offset()).toBe(0);
});

test("a deep link opens on its page without a slide or a vibration", async () => {
  const screen = await render(Harness, { initial: "grid" });

  expect(offset()).toBe(0);
  await expect.element(screen.getByText("Seite Netz & Einspeisung")).toBeVisible();
  expect(vibrate).not.toHaveBeenCalled();
});

/** Drags from the box's left edge by `dx` px in `steps` moves `ms` apart. */
async function swipe(dx: number, steps: number, ms: number, release = true): Promise<void> {
  const box = document.querySelector("[data-drill=box]")!;
  const { left, top } = box.getBoundingClientRect();

  const at = (x: number) => ({ pointerId: 1, clientX: left + x, clientY: top + 20, bubbles: true });

  const moveTo = async (i: number): Promise<void> => {
    if (i > steps) return;

    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
    box.dispatchEvent(new PointerEvent("pointermove", at(4 + (dx * i) / steps)));
    await moveTo(i + 1);
  };

  box.dispatchEvent(new PointerEvent("pointerdown", at(4)));
  await moveTo(1);

  if (release) box.dispatchEvent(new PointerEvent("pointerup", at(4 + dx)));
}

test("the edge-swipe follows the finger 1:1", async () => {
  await render(Harness, { initial: "battery" });

  await swipe(100, 5, 16, false);

  const width = document.querySelector<HTMLElement>("[data-drill=box]")?.offsetWidth ?? 0;

  expect(offset()).toBeCloseTo((100 / width) * 100, 1);
});

test("a swipe released early springs the page back", async () => {
  await render(Harness, { initial: "battery" });

  await swipe(80, 8, 30);

  await until(() => offset() === 0);
});

test("a swipe past halfway goes back", async () => {
  await render(Harness, { initial: "battery" });

  await swipe(260, 8, 16);

  await until(() => child() === null);
});

test("from 1024 px the groups and the chosen group sit side by side", async () => {
  await page.viewport(1280, 800);
  const screen = await render(Harness);

  // No group chosen: the first one shows.
  await expect.element(screen.getByText("Seite Batterie")).toBeVisible();
  await screen.getByRole("button", { name: /Netz/u }).click();

  await expect.element(screen.getByText("Seite Netz & Einspeisung")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /Netz/u }))
    .toHaveAttribute("aria-current", "page");
  expect(vibrate).toHaveBeenCalledOnce();
});
