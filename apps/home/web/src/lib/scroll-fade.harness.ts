// Test helper for the scroll fade (ADR 21): which scroll containers on the page have none.
import { expect } from "vitest";

/** Whether a computed overflow makes a scroll container. */
const scrolling = (flow: string) => flow === "auto" || flow === "scroll";

/**
 * Every scroll container in the document without a scroll-fade mask, as its tag and classes. A
 * page with no scroll container fails here: an empty answer would vouch for nothing.
 */
export function unfaded(): string[] {
  const scrollers = [...document.body.querySelectorAll("*")].filter((element) => {
    const style = getComputedStyle(element);

    // A textarea scrolls its own text under its own scrollbar; a fade would dim what is typed.
    return (
      element.tagName !== "TEXTAREA" && (scrolling(style.overflowX) || scrolling(style.overflowY))
    );
  });

  expect(scrollers.length, "scroll containers on the page").toBeGreaterThan(0);

  return scrollers.flatMap((element) =>
    getComputedStyle(element).maskImage === "none"
      ? [`${element.tagName.toLowerCase()}.${element.className}`]
      : [],
  );
}
