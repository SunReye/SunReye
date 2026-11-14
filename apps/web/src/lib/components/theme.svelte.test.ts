import { afterEach, expect, test } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Theme from "./theme.harness.svelte";

const root = document.documentElement;

afterEach(async () => {
  root.classList.remove("dark");
  delete root.dataset["lowPower"];
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

function background(element: Element): string {
  return getComputedStyle(element).backgroundColor;
}

/** The alpha of a computed colour; 1 when the colour has none. */
function alpha(colour: string): number {
  return Number(/\/\s*([\d.]+)\)$/u.exec(colour)?.[1] ?? 1);
}

/** Lightness, chroma and hue of a computed `oklch()` colour. */
function oklch(colour: string): number[] {
  return (colour.match(/[\d.]+/gu) ?? []).map(Number);
}

function glassSurfaces(): Element[] {
  return [...(document.querySelector("[data-testid=glass]")?.children ?? [])];
}

test("ambient glass is about 64 % opaque in light and 58 % in dark", async () => {
  const screen = await render(Theme);
  const ambient = screen.getByTestId("ambient").element();

  expect(alpha(background(ambient))).toBeCloseTo(0.64, 2);

  root.classList.add("dark");

  expect(alpha(background(ambient))).toBeCloseTo(0.58, 2);
});

test("overlay glass keeps kbase's tokens", async () => {
  await render(Theme);
  const [, overlay, modal] = glassSurfaces();

  // An open modal turns the overlay glass under it opaque.
  modal!.remove();

  expect(alpha(background(overlay!))).toBeCloseTo(0.88, 2);
  expect(getComputedStyle(overlay!).backdropFilter).toBe("blur(8px)");
});

test("prefers-reduced-transparency makes every glass surface opaque", async () => {
  await render(Theme);

  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
  });

  for (const theme of ["light", "dark"]) {
    root.classList.toggle("dark", theme === "dark");

    for (const surface of glassSurfaces()) {
      expect(alpha(background(surface)), `${theme} ${surface.className}`).toBe(1);
      expect(getComputedStyle(surface).backdropFilter).toBe("none");
    }
  }
});

test("the low-power switch makes every glass surface opaque", async () => {
  await render(Theme);

  root.dataset["lowPower"] = "";

  for (const theme of ["light", "dark"]) {
    root.classList.toggle("dark", theme === "dark");

    for (const surface of glassSurfaces()) {
      expect(alpha(background(surface)), `${theme} ${surface.className}`).toBe(1);
      expect(getComputedStyle(surface).backdropFilter).toBe("none");
    }
  }
});

test("every control's corners follow --radius, which is 0.125rem", async () => {
  const screen = await render(Theme);
  const controls = [...screen.getByTestId("controls").element().querySelectorAll("*")];

  expect(getComputedStyle(root).getPropertyValue("--radius").trim()).toBe("0.125rem");

  // Transitions would report the corner mid-flight.
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  // With the token at zero, a corner that stays round is set by the component, not the token.
  root.style.setProperty("--radius", "0px");

  try {
    for (const control of controls) {
      expect(getComputedStyle(control).borderTopLeftRadius, control.outerHTML).toBe("0px");
    }
  } finally {
    root.style.removeProperty("--radius");
  }
});

test("primary and brand are blue-600 in light, brand a lighter blue in dark", async () => {
  const screen = await render(Theme);
  const colour = (id: string) => oklch(background(screen.getByTestId(id).element()));

  const sameColour = (a: string, b: string) => {
    for (const [index, channel] of colour(a).entries()) {
      // The preset rounds Tailwind's hue 262.881 to 262.9.
      expect(channel, `${a} against ${b}`).toBeCloseTo(colour(b)[index]!, 1);
    }
  };

  sameColour("primary", "blue-600");
  sameColour("brand", "blue-600");

  root.classList.add("dark");

  sameColour("brand", "blue-500");
});
