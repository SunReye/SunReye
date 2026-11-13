import { createRawSnippet } from "svelte";
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { haptics } from "../haptics.ts";
import { locales, setLocale } from "../paraglide/runtime.js";
import Shell from "./Shell.svelte";
import "../../app.css";

const children = createRawSnippet(() => ({ render: () => "<p>page</p>" }));

const tall = createRawSnippet(() => ({
  render: () => '<p style="height: 3000px">page</p>',
}));

afterEach(() => {
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

test("on a phone the bar holds exactly five items, above the screen's edge", async () => {
  await phone("/", true);

  const names = Array.from(
    bar().element().querySelectorAll("[role=radio]"),
    (item) => item.ariaLabel,
  );

  expect(names).toEqual(["Dashboard", "Verlauf", "Prognose", "Tarif und Ersparnis", "Mehr"]);
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

test("the bar names Tariff short and keeps its full name for assistive tech", async () => {
  await phone("/");

  const tariff = bar().getByRole("radio", { name: "Tarif und Ersparnis" });

  await expect.element(tariff.getByText("Tarif", { exact: true })).toBeVisible();
});

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

test("More lists the other screens and opens with a soft tap", async () => {
  const soft = vi.spyOn(haptics, "soft");

  await phone("/");
  await openMore();

  expect(soft).toHaveBeenCalledOnce();
  const links = sheet().getByRole("link");

  expect(links.elements()).toHaveLength(3);
  await expect.element(links.nth(0)).toHaveTextContent("Einstellungen");
  await expect.element(links.nth(1)).toHaveTextContent("3D-Haus");
  await expect.element(links.nth(2)).toHaveTextContent("Status");
});

test("More lists Controls first and Devices after Settings for the admin", async () => {
  await phone("/", true);
  await openMore();
  const links = sheet().getByRole("link");

  await expect.element(links.first()).toHaveAttribute("href", "#/controls");
  await expect
    .element(sheet().getByRole("link", { name: /Geräte/u }))
    .toHaveAttribute("href", "#/settings?group=devices");
  expect(links.elements()[2]?.getAttribute("href")).toBe("#/settings?group=devices");
});

test("a screen picked in More closes the sheet", async () => {
  await phone("/");
  await openMore();
  await sheet().getByRole("link", { name: "Status" }).click();

  expect(location.hash).toBe("#/status");
  await expect.element(sheet()).not.toBeInTheDocument();
});

/** The More sheet's drag offset in px, as the finger or the spring left it. */
function lift(): number {
  const { translate } = getComputedStyle(sheet().element());

  return Number(/0px ([-\d.]+)px/u.exec(translate)?.[1] ?? 0);
}

/** Puts a finger on the sheet and moves it `dy` px down; lifts it there when `release`. */
function drag(dy: number, release: boolean): void {
  const element = sheet().element();
  const { left, top } = element.getBoundingClientRect();

  const at = (y: number) => ({
    pointerId: 1,
    clientX: left + 40,
    clientY: top + 20 + y,
    bubbles: true,
  });

  element.dispatchEvent(new PointerEvent("pointerdown", at(0)));
  element.dispatchEvent(new PointerEvent("pointermove", at(dy)));

  if (release) element.dispatchEvent(new PointerEvent("pointerup", at(dy)));
}

test("the More sheet follows the finger and springs back when let go early", async () => {
  await phone("/");
  await openMore();

  drag(40, false);
  await expect.poll(lift).toBe(40);

  sheet()
    .element()
    .dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));

  await expect.poll(lift).toBe(0);
  await expect.element(sheet()).toBeVisible();
});

test("the More sheet dragged far down closes", async () => {
  await phone("/");
  await openMore();

  drag(500, true);

  await expect.element(sheet()).not.toBeInTheDocument();
});
