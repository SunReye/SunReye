/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// The ambient glass is thin so the backdrop's lights show through it; its text must stay readable
// wherever a light is brightest (ADR 21).
import { toast } from "svelte-sonner";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { Toaster } from "../components/ui/sonner/index.js";
import { stepUntil } from "../motion/clock.harness.ts";
import Backdrop from "./Backdrop.svelte";
import {
  drifts,
  handBeat,
  lights,
  noon,
  plantStream,
  RESTING,
  root,
  teardown,
  TINTS,
} from "./backdrop.harness.ts";
import "../../app.css";

afterEach(() => {
  vi.useRealTimers();
  teardown();
});

type Rgb = readonly [number, number, number];

/** A CSS colour expression as the browser computes it. */
function computed(property: "color" | "backgroundColor", className: string, value = ""): string {
  const probe = document.createElement("div");

  probe.className = className;
  probe.style[property] = value;
  document.body.append(probe);

  const colour = getComputedStyle(probe)[property];

  probe.remove();

  return colour;
}

/** A computed colour as painted: sRGB, 0 to 255. */
function paintedColour(colour: string): Rgb {
  const element = document.createElement("canvas");

  element.width = element.height = 1;

  const context = element.getContext("2d")!;

  context.fillStyle = colour;
  context.fillRect(0, 0, 1, 1);

  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;

  return [r, g, b];
}

/** A token's colour as painted. */
const token = (name: string): Rgb => paintedColour(computed("color", "", `var(${name})`));

/** Every fourth pixel of the page as painted now. */
async function paintedPixels(): Promise<Rgb[]> {
  const image = new Image();

  image.src = `data:image/png;base64,${await page.screenshot({ save: false })}`;
  await image.decode();

  const element = document.createElement("canvas");

  element.width = image.width;
  element.height = image.height;

  const context = element.getContext("2d")!;

  context.drawImage(image, 0, 0);

  const { data } = context.getImageData(0, 0, image.width, image.height);
  const pixels: Rgb[] = [];

  for (let y = 0; y < image.height; y += 4)
    for (let x = 0; x < image.width; x += 4) {
      const at = (y * image.width + x) * 4;

      pixels.push([data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0]);
    }

  return pixels;
}

const clamp = (c: number): number => Math.min(Math.max(c, 0), 255);

/** The filter effects `saturate()` matrix, on sRGB as CSS filters work. */
function saturate([r, g, b]: Rgb, s: number): Rgb {
  return [
    clamp((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b),
    clamp((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b),
    clamp((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b),
  ];
}

/** Ambient glass over `behind`. Its blur only averages what is behind it, so a pixel is the bound. */
function glassOver(behind: Rgb, card: Rgb, opacity: number): Rgb {
  const lit = saturate(behind, 1.4);
  const mixed = (i: 0 | 1 | 2): number => card[i] * opacity + lit[i] * (1 - opacity);

  return [mixed(0), mixed(1), mixed(2)];
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

const INKS = ["--foreground", "--card-foreground", "--muted-foreground"] as const;

/** A phone and a desk at half size: the lights are laid out in shares of the viewport. */
const SCREENS = [
  { width: 195, height: 422 },
  { width: 640, height: 400 },
] as const;

/** Every picture the backdrop can paint: where the lights rest, then where their drift has taken them. */
const PICTURES = SCREENS.flatMap((size) =>
  (["light", "dark"] as const).flatMap((theme) =>
    [undefined, ...TINTS].flatMap((tint) =>
      [0, 20, 45].map((seconds) => ({ size, theme, tint, seconds })),
    ),
  ),
);

const STATUSES = ["success", "warning", "error"] as const;

type Theme = "light" | "dark";

type Ink = (typeof INKS)[number] | (typeof STATUSES)[number];

/** The colour of each status toast's icon, per theme: a toast is ambient glass too (#760). */
async function statusInks(): Promise<Record<Theme, Record<(typeof STATUSES)[number], Rgb>>> {
  // A toast's time is the test's: it closes, and leaves once dismissed, as the clock is run on.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await render(Toaster);

  const read = async (theme: Theme) => {
    root.classList.toggle("dark", theme === "dark");

    const inks: Record<(typeof STATUSES)[number], Rgb> = {
      success: [0, 0, 0],
      warning: [0, 0, 0],
      error: [0, 0, 0],
    };

    for (const status of STATUSES) {
      const text = `${status} ${theme}`;

      toast[status](text);
      // oxlint-disable-next-line no-await-in-loop -- one toast at a time.
      await expect.element(page.getByText(text)).toBeVisible();

      const icon = page
        .getByText(text)
        .element()
        .closest("[data-sonner-toast]")!
        .querySelector("[data-icon]")!;

      inks[status] = paintedColour(getComputedStyle(icon).color);
    }

    return inks;
  };

  const inks = { light: await read("light"), dark: await read("dark") };

  // The toasts are out of the picture before it is measured.
  toast.dismiss();
  await stepUntil(
    () => document.querySelectorAll("[data-sonner-toast]").length === 0,
    () => {
      vi.advanceTimersByTime(100);
    },
  );
  vi.useRealTimers();

  return inks;
}

/** Each ink's lowest contrast on ambient glass anywhere over the page as painted now. */
async function weakest(
  status: Record<(typeof STATUSES)[number], Rgb>,
): Promise<Record<Ink, number>> {
  const card = token("--card");

  const opacity = Number(
    getComputedStyle(root).getPropertyValue("--ambient-opacity").replace("%", ""),
  );

  const glass = (await paintedPixels()).map((pixel) => glassOver(pixel, card, opacity / 100));

  const lowest = (ink: Rgb): number => Math.min(...glass.map((behind) => contrast(ink, behind)));

  return {
    "--foreground": lowest(token("--foreground")),
    "--card-foreground": lowest(token("--card-foreground")),
    "--muted-foreground": lowest(token("--muted-foreground")),
    success: lowest(status.success),
    warning: lowest(status.warning),
    error: lowest(status.error),
  };
}

/** A test a screen, a theme and a tint: each fits vitest's budget beside the other files. */
const CASES = SCREENS.flatMap((size) =>
  (["light", "dark"] as const).flatMap((theme) =>
    [undefined, ...TINTS].map((tint) => ({ size, theme, tint: tint ?? "none" })),
  ),
);

test.for(CASES)(
  "text and a toast's status icon on ambient glass keep AA contrast over the brightest light: $size.width px, $theme, $tint",
  async (shown) => {
    const produce = plantStream();
    const hand = handBeat();
    const status = await statusInks();
    const screen = await render(Backdrop, { core: noon, beat: hand.beat });

    produce(1_000_000);
    await expect
      .poll(() => screen.container.querySelector<HTMLElement>("[data-light=pv]")!.style.opacity)
      .toBe("1");

    // The glow has come on in full, not part of the way.
    for (const coming of lights(screen.container).flatMap((light) => light.getAnimations()))
      coming.finish();

    const measure = async ({ size, theme, tint, seconds }: (typeof PICTURES)[number]) => {
      await page.viewport(size.width, size.height);
      root.classList.toggle("dark", theme === "dark");

      if (tint === undefined) delete root.dataset["tod"];
      else root.dataset["tod"] = tint;

      hand.at(seconds);
      await expect.poll(() => drifts(screen.container).includes(RESTING)).toBe(seconds === 0);

      return weakest(status[theme]);
    };

    for (const picture of PICTURES.filter(
      (p) => p.size === shown.size && p.theme === shown.theme && (p.tint ?? "none") === shown.tint,
    )) {
      // oxlint-disable-next-line no-await-in-loop -- one picture at a time: each is set, then measured.
      const ratios = await measure(picture);

      for (const ink of [...INKS, ...STATUSES])
        expect(ratios[ink], `${ink}, ${JSON.stringify(picture)}`).toBeGreaterThanOrEqual(4.5);
    }
  },
);
