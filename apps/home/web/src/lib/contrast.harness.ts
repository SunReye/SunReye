// Test helpers for text on a translucent surface (ADR 21 "Glass"): colours as the browser
// composites them over what lies behind, and WCAG's contrast between two of them.

type Rgb = readonly [number, number, number];

/** Colours as they land: a theme's colours fade in over a moment, which is not what is read. */
export const still = document.createElement("style");

still.textContent = "* { transition: none !important; }";

/** A computed colour painted over `behind`, as the browser composites it. */
function over(colour: string, [red, green, blue]: Rgb): Rgb {
  const canvas = document.createElement("canvas");

  canvas.width = canvas.height = 1;

  const context = canvas.getContext("2d");

  if (context === null) throw new TypeError("no 2D canvas");

  context.fillStyle = `rgb(${red} ${green} ${blue})`;
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = colour;
  context.fillRect(0, 0, 1, 1);

  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;

  return [r, g, b];
}

function luminance(colour: Rgb): number {
  const [r = 0, g = 0, b = 0] = colour.map((c) => {
    const s = c / 255;

    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG's contrast ratio of two colours. */
function contrast(a: Rgb, b: Rgb): number {
  const [lighter = 0, darker = 0] = [luminance(a), luminance(b)].toSorted((p, q) => q - p);

  return (lighter + 0.05) / (darker + 0.05);
}

/** The least contrast `ink`'s colour keeps on `surface`'s, over the darkest and the brightest a
 * scene shows behind it: black modules and night, and a sunlit white wall. */
export function least(ink: Element, surface: Element): number {
  const chip = getComputedStyle(surface).backgroundColor;
  const text = getComputedStyle(ink).color;

  return Math.min(
    ...[0, 255].map((grey) => {
      const chipped = over(chip, [grey, grey, grey]);

      return contrast(over(text, chipped), chipped);
    }),
  );
}
