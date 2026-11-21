import { createRawSnippet } from "svelte";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import Eyebrow from "./eyebrow.svelte";
import PageTitle from "./page-title.svelte";
import Section from "./section.svelte";
import StatStrip from "./stat-strip.svelte";
import * as Card from "./ui/card/index.js";

const body = createRawSnippet(() => ({ render: () => `<p>Inhalt</p>` }));
const action = createRawSnippet(() => ({ render: () => `<a href="#/x">Mehr</a>` }));

/** The alpha of a computed colour; 1 when the colour has none. */
function alpha(colour: string): number {
  return Number(/\/\s*([\d.]+)\)$/u.exec(colour)?.[1] ?? 1);
}

const px = (length: string) => Number(length.replace("px", ""));

test("a page title is the screen's first heading, smaller over a wide chart screen", async () => {
  const screen = await render(PageTitle, { title: "Status" });
  const heading = screen.getByRole("heading", { level: 1, name: "Status" }).element();
  const size = px(getComputedStyle(heading).fontSize);

  await screen.rerender({ title: "Status", wide: true });

  expect(px(getComputedStyle(heading).fontSize)).toBeLessThan(size);
});

test("a section is a region named by its title, with its actions beside it", async () => {
  const screen = await render(Section, { title: "Preise", actions: action, children: body });
  const region = screen.getByRole("region", { name: "Preise" });

  await expect.element(region.getByRole("heading", { level: 2, name: "Preise" })).toBeVisible();
  await expect.element(region.getByRole("link", { name: "Mehr" })).toBeVisible();
  await expect.element(region.getByText("Inhalt")).toBeVisible();
  expect(getComputedStyle(region.element()).backdropFilter).toBe("none");
});

test("a section as a card sits on ambient glass", async () => {
  const screen = await render(Section, { title: "Protokoll", card: true, children: body });
  const region = screen.getByRole("region", { name: "Protokoll" }).element();

  expect(getComputedStyle(region).backdropFilter).not.toBe("none");
});

test("a card in ambient glass is translucent with the card's corner, opaque under the low-power switch", async () => {
  const screen = await render(Card.Root, {
    children: body,
    element: "section",
    "aria-label": "Karte",
    class: "glass-ambient",
  });

  const card = screen.getByRole("region", { name: "Karte" }).element();
  const style = getComputedStyle(card);

  // The radius token's 0.125 rem at the card's 1.4.
  expect(style.borderTopLeftRadius).toBe("2.8px");
  expect(alpha(style.backgroundColor)).toBeLessThan(1);

  document.documentElement.dataset["lowPower"] = "";

  try {
    expect(alpha(getComputedStyle(card).backgroundColor)).toBe(1);
  } finally {
    delete document.documentElement.dataset["lowPower"];
  }
});

test("an interactive card is a button that runs its press and never submits a form", async () => {
  const onclick = vi.fn<() => void>();
  const screen = await render(Card.Root, { children: body, interactive: true, onclick });
  const button = screen.getByRole("button", { name: "Inhalt" });

  await expect.element(button).toHaveAttribute("type", "button");
  await expect.element(button).toHaveAttribute("data-slot", "card");

  const press = button.element();

  // A DOM click: the hover's lift would keep the pointer's target moving under load.
  if (press instanceof HTMLElement) press.click();

  expect(onclick).toHaveBeenCalledOnce();
});

test("a stat strip lists each figure under its label, in tabular figures", async () => {
  const screen = await render(StatStrip, {
    stats: [
      { label: "Abdeckung", value: "98 %" },
      { label: "Lücken", value: "3,5 h" },
    ],
  });

  await expect.element(screen.getByRole("term").first()).toHaveTextContent("Abdeckung");

  const value = screen.getByRole("definition").first();

  await expect.element(value).toHaveTextContent("98 %");
  expect(getComputedStyle(value.element()).fontVariantNumeric).toBe("tabular-nums");
  expect(screen.getByRole("term").elements()).toHaveLength(2);
});

test("a page title with the brand shows the sun mark beside it, outside its name", async () => {
  const screen = await render(PageTitle, { title: "Anmelden", brand: true });
  const heading = screen.getByRole("heading", { level: 1, name: "Anmelden", exact: true });

  await expect.element(heading).toBeVisible();
  expect(heading.element().parentElement?.querySelector("svg")).not.toBeNull();
});

test("an eyebrow is a small uppercase heading of the level asked for", async () => {
  const screen = await render(Eyebrow, { element: "h3", children: body });
  const heading = screen.getByRole("heading", { level: 3 }).element();

  expect(getComputedStyle(heading).textTransform).toBe("uppercase");
  expect(px(getComputedStyle(heading).fontSize)).toBe(12);
});

test("a section under an eyebrow is a region named by it", async () => {
  const screen = await render(Section, { title: "Amortisation", eyebrow: true, children: body });
  const region = screen.getByRole("region", { name: "Amortisation" });
  const heading = region.getByRole("heading", { level: 2, name: "Amortisation" }).element();

  expect(getComputedStyle(heading).textTransform).toBe("uppercase");
});
