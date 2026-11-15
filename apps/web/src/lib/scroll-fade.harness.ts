// Test helper for the scroll fade (ADR 21): which scroll containers on the page have none.

/** Whether a computed overflow makes a scroll container. */
const scrolling = (flow: string) => flow === "auto" || flow === "scroll";

/** Every scroll container in the document without a scroll-fade mask, as its tag and classes. */
export function unfaded(): string[] {
  return [...document.body.querySelectorAll("*")].flatMap((element) => {
    const style = getComputedStyle(element);
    const scrolls = scrolling(style.overflowX) || scrolling(style.overflowY);

    // A textarea scrolls its own text under its own scrollbar; a fade would dim what is typed.
    return element.tagName !== "TEXTAREA" && scrolls && style.maskImage === "none"
      ? [`${element.tagName.toLowerCase()}.${element.className}`]
      : [];
  });
}
