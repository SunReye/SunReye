import { createRawSnippet } from "svelte";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import SectionHeader from "./section-header.svelte";

// A section card's header: the title in one grid track, the chrome in another.
// The German strings are the long ones, and this is the longest of them.

const TITLE = "PV-Spitzenkappung & Prognoseladen";
const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }));

afterEach(async () => {
  await page.viewport(414, 896);
});

/**
 * Mount the header in the room a 320px phone leaves it: the page shell's and
 * the section card's gutters both come out of the viewport (16 + 12 a side).
 */
async function mountAt(viewport: number, room: number) {
  await page.viewport(viewport, 800);
  const { container } = await render(SectionHeader, {
    title: TITLE,
    actions: html('<button aria-label="Filter">F</button>'),
  });
  container.style.width = `${room}px`;
  const heading = page.getByRole("heading", { name: TITLE }).element() as HTMLElement;
  return { container, heading };
}

test("on a phone a title that does not fit wraps instead of losing its end", async () => {
  const { heading } = await mountAt(320, 264);

  // Every character is drawn: nothing clipped behind an ellipsis.
  expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth);
  expect(heading.getBoundingClientRect().height).toBeGreaterThan(
    Number.parseFloat(getComputedStyle(heading).lineHeight) * 1.5,
  );
});

test("on a desktop the same squeeze truncates to one line", async () => {
  const { heading } = await mountAt(1280, 264);

  expect(getComputedStyle(heading).textOverflow).toBe("ellipsis");
  expect(heading.scrollWidth).toBeGreaterThan(heading.clientWidth);
});

test("a long title never moves the chrome off the right edge or onto a second row", async () => {
  const { container } = await mountAt(320, 264);

  const header = container.firstElementChild!.getBoundingClientRect();
  const chrome = page.getByRole("button", { name: "Filter" }).element().getBoundingClientRect();
  const heading = page.getByRole("heading", { name: TITLE }).element().getBoundingClientRect();
  expect(Math.abs(chrome.right - header.right)).toBeLessThan(1);
  expect(Math.round(chrome.top)).toBe(Math.round(heading.top));
});
