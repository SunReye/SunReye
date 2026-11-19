// Test helper for the 3D canvas's overlays (ADR 21 "Glass"): what lies over the canvas and
// blurs what is behind it, which the browser would do again for every frame the canvas draws.

/** Every element drawn over the builder's canvas with a backdrop blur, as its tag and classes. */
export function blurred(): string[] {
  const canvas = document.querySelector("canvas");

  if (canvas === null) throw new TypeError("no canvas");

  const under = canvas.getBoundingClientRect();

  return [...document.body.querySelectorAll("*")].flatMap((element) => {
    const box = element.getBoundingClientRect();

    const over =
      !element.contains(canvas) &&
      box.width > 0 &&
      box.height > 0 &&
      box.left < under.right &&
      box.right > under.left &&
      box.top < under.bottom &&
      box.bottom > under.top;

    return over && getComputedStyle(element).backdropFilter !== "none"
      ? [`${element.tagName.toLowerCase()}.${element.getAttribute("class") ?? ""}`.slice(0, 60)]
      : [];
  });
}
