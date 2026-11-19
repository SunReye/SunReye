// Test helper for the 3D canvas's overlays (ADR 21 "Glass"): what lies over the canvas and
// blurs what is behind it, which the browser would do again for every frame the canvas draws.

/** Whether two boxes share any of the page; a box of no size shares none. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the browser's own boxes.
function overlap(a: DOMRect, b: DOMRect): boolean {
  const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);

  return a.width > 0 && a.height > 0 && across > 0 && down > 0;
}

/** Every element drawn over the builder's canvas with a backdrop blur, as its tag and classes. */
export function blurred(): string[] {
  const canvas = document.querySelector("canvas");

  if (canvas === null) throw new TypeError("no canvas");

  const under = canvas.getBoundingClientRect();

  /** Whether `element` lies over the canvas and blurs what is behind it. */
  const blurs = (element: Element): boolean =>
    !element.contains(canvas) &&
    overlap(element.getBoundingClientRect(), under) &&
    getComputedStyle(element).backdropFilter !== "none";

  return [...document.body.querySelectorAll("*")].flatMap((element) =>
    blurs(element)
      ? [`${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""}`.slice(0, 60)]
      : [],
  );
}
