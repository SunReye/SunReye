/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// A toast is one of the app's floating surfaces (ADR 21): the radius token and the bottom bar's
// ambient glass, ring and elevation, whatever its type.
import { toast } from "svelte-sonner";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { clearToasts, holdToasts } from "./toasts.harness.ts";
import { Toaster } from "./ui/sonner/index.js";
import "../../app.css";
import { alpha } from "../alpha.harness.ts";

const root = document.documentElement;
const nothing = (): void => {};

/** Every toast the app can raise, by the text it shows. */
const TOASTS = {
  plain: (text: string) => toast(text, { description: "80 A" }),
  success: (text: string) => toast.success(text, { description: "80 A" }),
  error: (text: string) => toast.error(text, { description: "80 A" }),
  info: (text: string) => toast.info(text, { description: "80 A" }),
  warning: (text: string) => toast.warning(text, { description: "80 A" }),
  loading: (text: string) => toast.loading(text, { description: "80 A" }),
  action: (text: string) => toast(text, { action: { label: "Undo", onClick: nothing } }),
  cancel: (text: string) => toast(text, { cancel: { label: "Dismiss", onClick: nothing } }),
  rich: (text: string) => toast.success(text, { description: "80 A", richColors: true }),
} as const;

type Type = keyof typeof TOASTS;

const TYPES = [
  "plain",
  "success",
  "error",
  "info",
  "warning",
  "loading",
  "action",
  "cancel",
  "rich",
] as const satisfies Type[];

const THEMES = ["light", "dark"] as const;

beforeEach(holdToasts);

afterEach(async () => {
  await clearToasts();
  root.classList.remove("dark");
});

/** What a probe with the app's own classes computes to: what the bar and the sheets wear. */
function worn(className: string) {
  const probe = document.createElement("div");

  probe.className = className;
  document.body.append(probe);

  const { backgroundColor, backdropFilter, boxShadow } = getComputedStyle(probe);

  probe.remove();

  return { backgroundColor, backdropFilter, boxShadow };
}

/** The shown toast of a type, its entrance over. */
async function shown(type: Type, theme: string): Promise<HTMLElement> {
  const text = `${type} ${theme}`;

  TOASTS[type](text);
  await expect.element(page.getByText(text)).toBeVisible();

  return page.getByText(text).element().closest<HTMLElement>("[data-sonner-toast]")!;
}

type Rgb = readonly [number, number, number];

/** A computed colour as painted over `behind`: sRGB, 0 to 255. */
function painted(colour: string, behind: Rgb = [0, 0, 0]): Rgb {
  const element = document.createElement("canvas");

  element.width = element.height = 1;

  const context = element.getContext("2d")!;

  context.fillStyle = `rgb(${behind.join(" ")})`;
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = colour;
  context.fillRect(0, 0, 1, 1);

  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;

  return [r, g, b];
}

function luminance(colour: Rgb): number {
  const [r = 0, g = 0, b = 0] = colour.map((c) => {
    const s = c / 255;

    return s <= 0.040_45 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio. */
function contrast(a: Rgb, b: Rgb): number {
  const [high = 0, low = 0] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);

  return (high + 0.05) / (low + 0.05);
}

/** The first painted fill under an element, itself included, over the plain page. */
function surface(element: Element, page_: Rgb): Rgb {
  let at: Element | null = element;
  const layers: string[] = [];

  while (at !== null) {
    layers.unshift(getComputedStyle(at).backgroundColor);
    at = at.parentElement;
  }

  let under = page_;

  for (const layer of layers) under = painted(layer, under);

  return under;
}

for (const theme of THEMES)
  for (const type of TYPES)
    test(`a ${type} toast wears the bar's glass, ring, elevation and the radius token (${theme})`, async () => {
      root.classList.toggle("dark", theme === "dark");
      await render(Toaster);

      const style = getComputedStyle(await shown(type, theme));
      const glass = worn("glass-ambient");

      // The 2 px token, not svelte-sonner's 8 px.
      expect(style.borderRadius).toBe("2px");
      expect(style.backdropFilter).toMatch(/^blur\(16px\) saturate\(1\.4\)$/u);
      expect(style.backdropFilter).toBe(glass.backdropFilter);
      expect(style.backgroundColor).toBe(glass.backgroundColor);
      expect(alpha(style.backgroundColor)).toBeLessThan(0.7);
      expect(style.boxShadow).toBe(worn("ring-1 ring-inset ring-border elevation-3").boxShadow);
      expect(style.borderTopWidth).toBe("0px");
    });

for (const theme of THEMES)
  test(`a toast's buttons take the button radius (${theme})`, async () => {
    root.classList.toggle("dark", theme === "dark");
    await render(Toaster);

    for (const type of ["action", "cancel"] as const) {
      // oxlint-disable-next-line no-await-in-loop -- one toast at a time.
      const button = (await shown(type, theme)).querySelector("[data-button]")!;

      expect(getComputedStyle(button).borderRadius).toBe("1.6px");
    }
  });

for (const theme of THEMES)
  for (const type of TYPES)
    test(`a ${type} toast's text and icon keep AA contrast on a plain screen (${theme})`, async () => {
      root.classList.toggle("dark", theme === "dark");
      await render(Toaster);

      const shownToast = await shown(type, theme);
      const plain = painted(getComputedStyle(root).getPropertyValue("--background"));

      const inks = [
        ...shownToast.querySelectorAll(
          "[data-title], [data-description], [data-icon], [data-button]",
        ),
      ];

      expect(inks.length).toBeGreaterThan(0);

      for (const ink of inks) {
        const behind = surface(ink, plain);
        const colour = painted(getComputedStyle(ink).color, behind);

        expect(contrast(colour, behind), ink.getAttributeNames().join(" ")).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    });
