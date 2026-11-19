import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import CameraLock from "../dashboard/CameraLock.svelte";
import ViewToggle from "../dashboard/ViewToggle.svelte";
import { PLANT } from "../api/core.ts";
import { chip, frame, show } from "./live-scene.harness.ts";
import { feed } from "./stream.harness.ts";

// Canvas chips (ADR 21 "Glass"): what floats over the 3D canvas has no backdrop blur, which the
// browser would make again for every frame the canvas draws, and stays readable without it.

afterEach(() => {
  document.documentElement.classList.remove("dark");
  still.remove();
});

/** Colours as they land: a theme's colours fade in over a moment, which is not what is read. */
const still = document.createElement("style");

still.textContent = "* { transition: none !important; }";

type Rgb = readonly [number, number, number];

/** A computed colour painted over a grey of `behind`, as the browser composites it. */
function over(colour: string, behind: number): Rgb {
  const canvas = document.createElement("canvas");

  canvas.width = canvas.height = 1;

  const context = canvas.getContext("2d");

  if (context === null) throw new TypeError("no 2D canvas");

  context.fillStyle = `rgb(${behind} ${behind} ${behind})`;
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

const blur = (element: Element): string => getComputedStyle(element).backdropFilter;

test("a live label over the scene has no backdrop blur", async () => {
  const tick = feed();

  await show();
  tick(frame(600, -1200));

  expect(blur((await chip("Süd", "600")).element())).toBe("none");
  expect(blur((await chip("Netz", "1,2")).element())).toBe("none");
});

test("a label's text holds AA over the darkest and the brightest a scene can show, in both themes", async () => {
  const tick = feed();

  await show();
  tick({
    devices: { "1": { "pv.string.power[11]": 600, "pv.power": 600 }, [PLANT]: { "grid.power": 0 } },
  });

  const label = (await chip("Süd", "600")).element();
  const name = label.querySelector(".text-muted-foreground");

  if (name === null) throw new TypeError("the chip has no name");

  document.head.append(still);

  for (const theme of ["light", "dark"]) {
    document.documentElement.classList.toggle("dark", theme === "dark");

    const surface = getComputedStyle(label).backgroundColor;

    // Black modules and night at one end, a sunlit white wall at the other.
    for (const behind of [0, 255]) {
      const chipped = over(surface, behind);

      for (const text of [label, name]) {
        const ink = over(getComputedStyle(text).color, behind);

        expect([theme, behind, contrast(ink, chipped) >= 4.5]).toEqual([theme, behind, true]);
      }
    }
  }
});

test("the camera lock and the view toggle over the scene have no backdrop blur either", async () => {
  const lock = await render(CameraLock, { locked: true });

  expect(blur(lock.getByRole("button", { name: "Kamera bewegen" }).element())).toBe("none");

  const toggle = await render(ViewToggle, {
    shows: "3d",
    toggles: true,
    build: false,
    onchoose: () => {},
  });

  expect(blur(toggle.getByRole("group", { name: "Ansicht" }).element())).toBe("none");
});
