import { afterEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Harness from "./pager.harness.svelte";

afterEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

function card(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-testid=card]")!;
}

/** The track's offset in px; 0 at rest. */
function offset(): number {
  const transform = card().querySelector<HTMLElement>(".track")?.style.transform ?? "";

  return transform === "" ? 0 : Number(/translateX\(([-\d.]+)px\)/u.exec(transform)?.[1]);
}

async function until(done: () => boolean): Promise<void> {
  await expect.poll(done, { timeout: 2000 }).toBe(true);
}

/** A finger drags the card by `dx` px in `steps` moves `ms` apart. */
async function drag(dx: number, steps: number, ms: number, release = true): Promise<void> {
  const { left, top } = card().getBoundingClientRect();

  const at = (x: number) => ({
    pointerId: 1,
    pointerType: "touch",
    clientX: left + 200 + x,
    clientY: top + 40,
    bubbles: true,
  });

  card().dispatchEvent(new PointerEvent("pointerdown", at(0)));

  for (let i = 1; i <= steps; i++) {
    // oxlint-disable-next-line no-await-in-loop -- the moves are paced like a finger's.
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
    card().dispatchEvent(new PointerEvent("pointermove", at((dx * i) / steps)));
  }

  if (release) card().dispatchEvent(new PointerEvent("pointerup", at(dx)));
}

test("a drag draws the neighbour beside the page and follows the finger", async () => {
  const screen = await render(Harness, { steps: [] });

  await drag(-120, 6, 16, false);

  await expect.element(screen.getByText("Seite 2")).toBeInTheDocument();
  expect(offset()).toBeLessThan(0);
});

test("a drag past the threshold pages to the neighbour", async () => {
  const steps: (-1 | 1)[] = [];
  const screen = await render(Harness, { steps });

  await drag(-220, 8, 16);

  await until(() => steps.length === 1);
  expect(steps).toEqual([1]);
  await until(() => offset() === 0);
  await expect.element(screen.getByText("Seite 2")).toBeVisible();
  expect(screen.getByText("Seite 1").query()).toBeNull();
});

test("a drag back to the earlier page steps back", async () => {
  const steps: (-1 | 1)[] = [];

  await render(Harness, { steps });
  await drag(220, 8, 16);

  await until(() => steps.length === 1);
  expect(steps).toEqual([-1]);
});

test("a short drag springs back without paging", async () => {
  const steps: (-1 | 1)[] = [];
  const screen = await render(Harness, { steps });

  await drag(-40, 8, 30);

  await until(() => offset() === 0);
  expect(steps).toEqual([]);
  await expect.element(screen.getByText("Seite 1")).toBeVisible();
});

test("still motion steps on a swipe without moving the pages", async () => {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  const steps: (-1 | 1)[] = [];
  const screen = await render(Harness, { steps });

  await drag(-120, 4, 16, false);
  expect(offset()).toBe(0);
  card().dispatchEvent(
    new PointerEvent("pointerup", {
      pointerId: 1,
      clientX: card().getBoundingClientRect().left + 80,
      clientY: card().getBoundingClientRect().top + 40,
      bubbles: true,
    }),
  );

  await until(() => steps.length === 1);
  await expect.element(screen.getByText("Seite 2")).toBeVisible();
});

test("the page that leaves on a crossfade takes no press, without going inert", async () => {
  const screen = await render(Harness, { steps: [] });
  const pressed = vi.fn();

  card().addEventListener("click", () => {
    pressed();
  });
  await screen.getByRole("button", { name: "Weiter" }).click();

  const leaving = screen.getByText("Seite 1").element();

  expect(leaving.closest(".pane")?.classList.contains("out")).toBe(true);
  // Inert would restyle all of the leaving page in the frame of the press that changed it.
  expect(leaving.closest("[inert]")).toBeNull();

  leaving.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(pressed).not.toHaveBeenCalled();

  screen
    .getByText("Seite 2")
    .element()
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(pressed).toHaveBeenCalledOnce();
});
