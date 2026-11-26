import { createRawSnippet } from "svelte";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { haptics } from "@sunreye/ui/haptics";
import { closed, finish } from "../motion/animations.harness.ts";
import { settle } from "../motion/clock.harness.ts";
import { motion } from "../../../../../../packages/builder/src/motion/tier.svelte.ts";
import { locales, setLocale } from "../paraglide/runtime.js";
import Shell from "./Shell.svelte";
import "../../app.css";

const children = createRawSnippet(() => ({ render: () => "<p>page</p>" }));

const tall = createRawSnippet(() => ({
  render: () => '<p style="height: 3000px">page</p>',
}));

afterEach(() => {
  motion.lowPower = false;
  vi.restoreAllMocks();
  scrollTo(0, 0);
  // The More sheet's links move the hash.
  history.replaceState(null, "", location.pathname + location.search);
});

/** SvelteKit's `goto`, which the root layout passes: no router runs here. */
const goto = vi.fn((_url: string) => Promise.resolve());

const bar = () => page.getByRole("navigation", { name: "Hauptnavigation" });

const sheet = () => page.getByRole("dialog", { name: "Mehr" });

async function phone(current: string, admin = false): Promise<void> {
  await page.viewport(400, 800);
  await render(Shell, { shell: "bar", current, admin, goto, children });
}

async function openMore(): Promise<void> {
  await bar().getByRole("radio", { name: "Mehr" }).click();
  await expect.element(sheet()).toBeVisible();
}

test("on a phone the bar holds three screens and More, above the screen's edge", async () => {
  await phone("/", true);

  const names = Array.from(
    bar().element().querySelectorAll("[role=radio]"),
    (item) => item.ariaLabel,
  );

  expect(names).toEqual(["Dashboard", "Verlauf", "Prognose", "Mehr"]);
  expect(bar().element().getBoundingClientRect().bottom).toBeLessThanOrEqual(800 - 8);
});

test.each(locales)(
  "no two bar labels overlap or leave their item at 320 px in %s",
  async (locale) => {
    onTestFinished(() => setLocale("de", { reload: false }));
    await setLocale(locale, { reload: false });
    await page.viewport(320, 700);

    const shown = await render(Shell, { shell: "bar", current: "/", admin: false, goto, children });
    const items = [...shown.container.querySelectorAll("nav [role=radio]")];

    const boxes = items.map((item) => {
      const label = item.querySelector("span")!;
      const [own, text] = [item.getBoundingClientRect(), label.getBoundingClientRect()];

      // The text as wide as it runs, not as its box clips it.
      expect(label.scrollWidth, label.textContent).toBeLessThanOrEqual(label.clientWidth);
      expect(text.left).toBeGreaterThanOrEqual(own.left);
      expect(text.right).toBeLessThanOrEqual(own.right);

      return text;
    });

    for (const [i, box] of boxes.entries())
      expect(box.right).toBeLessThanOrEqual(boxes[i + 1]?.left ?? Infinity);
  },
);

test("the bar never hides on scroll and the page ends above it", async () => {
  await page.viewport(400, 800);
  await render(Shell, { shell: "bar", current: "/", admin: false, goto, children: tall });
  const before = bar().element().getBoundingClientRect().top;

  scrollTo(0, document.documentElement.scrollHeight);

  expect(scrollY).toBeGreaterThan(0);
  await expect.element(bar()).toBeVisible();
  expect(bar().element().getBoundingClientRect().top).toBe(before);

  const end = page.getByText("page").element().getBoundingClientRect().bottom;

  expect(end).toBeLessThanOrEqual(bar().element().getBoundingClientRect().top);
});

test("a bar item moves to its screen through the router and ticks selection", async () => {
  const selection = vi.spyOn(haptics, "selection");

  goto.mockClear();
  await phone("/");
  await bar().getByRole("radio", { name: "Dashboard" }).click();

  expect(selection).not.toHaveBeenCalled();

  await bar().getByRole("radio", { name: "Verlauf" }).click();

  // A bare hash write reads to the hash router as an address-bar edit: a full reload, a white frame.
  expect(goto).toHaveBeenCalledExactlyOnceWith("#/history");
  expect(location.hash).toBe("");
  expect(selection).toHaveBeenCalledOnce();
});

test("the bar marks the shown screen", async () => {
  await phone("/forecast");

  await expect
    .element(bar().getByRole("radio", { name: "Prognose" }))
    .toHaveAttribute("aria-checked", "true");
});

test("a screen inside More marks More, and More opens again from it", async () => {
  await phone("/status");

  await expect
    .element(bar().getByRole("radio", { name: "Mehr" }))
    .toHaveAttribute("aria-checked", "true");
  await openMore();
});

test("More lists the other screens and opens with a bar item's tick", async () => {
  const selection = vi.spyOn(haptics, "selection");

  await phone("/");
  await openMore();

  expect(selection).toHaveBeenCalledOnce();
  const links = sheet().getByRole("link");

  expect(links.elements()).toHaveLength(5);
  await expect.element(links.nth(0)).toHaveTextContent("Erkunden");
  await expect.element(links.nth(1)).toHaveTextContent("Tarif und Ersparnis");
  await expect.element(links.nth(2)).toHaveTextContent("Einstellungen");
  await expect.element(links.nth(3)).toHaveTextContent("3D-Haus");
  await expect.element(links.nth(4)).toHaveTextContent("Status");
});

test("More lists Controls first, then Explore and Tariff, and Devices after Settings for the admin", async () => {
  await phone("/", true);
  await openMore();
  const links = sheet().getByRole("link");

  await expect.element(links.first()).toHaveAttribute("href", "#/controls");
  await expect.element(links.nth(1)).toHaveAttribute("href", "#/explore");
  await expect.element(links.nth(2)).toHaveAttribute("href", "#/tariff");
  await expect
    .element(sheet().getByRole("link", { name: /Geräte/u }))
    .toHaveAttribute("href", "#/settings?group=devices");
  expect(links.elements()[4]?.getAttribute("href")).toBe("#/settings?group=devices");
});

test("a screen picked in More closes the sheet", async () => {
  await phone("/");
  await openMore();
  await sheet().getByRole("link", { name: "Status" }).click();

  expect(location.hash).toBe("#/status");
  await closed(sheet());
});

/** What `mark` glides on now: its transitions' properties, read off its style as it is. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own element.
const glides = (mark: Element) =>
  mark
    .getAnimations()
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own animation.
    .flatMap((glide) => (glide instanceof CSSTransition ? [glide.transitionProperty] : []));

/** The sliding selection, and how far its left edge is from the named item's. */
function slidingMark() {
  const mark = bar().element().querySelector<HTMLElement>("[data-selection]")!;

  return {
    mark,
    off: (name: string) =>
      Math.abs(
        mark.getBoundingClientRect().left -
          bar().getByRole("radio", { name }).element().getBoundingClientRect().left,
      ),
  };
}

test("the selection slides to the shown screen on a transform alone", async () => {
  await page.viewport(400, 800);

  const shown = await render(Shell, { shell: "bar", current: "/", admin: false, goto, children });
  const { mark, off } = slidingMark();

  // Placed once its size observer is told the item's size.
  await settle(() => off("Dashboard") < 1);

  const group = bar().element().querySelector("[data-slot=toggle-group]")!;

  // The registry's own pressed box moves on `left` and `width`, which are layout.
  expect(getComputedStyle(group, "::before").display).toBe("none");

  await shown.rerender({ current: "/forecast" });

  expect(glides(mark)).toEqual(["transform"]);
  // The glide ends where the screen's item is.
  await finish(() => off("Prognose") < 1);
  expect(mark.style.left).toBe("0px");
});

test("on the still tier the selection is on the shown screen at once", async () => {
  motion.lowPower = true;
  await page.viewport(400, 800);

  const shown = await render(Shell, { shell: "bar", current: "/", admin: false, goto, children });
  const { mark, off } = slidingMark();

  await settle(() => off("Dashboard") < 1);
  await shown.rerender({ current: "/forecast" });

  await settle(() => off("Prognose") < 1);
  expect(glides(mark)).toEqual([]);
});
