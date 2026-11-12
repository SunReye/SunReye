import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Backdrop from "./Backdrop.svelte";
import "../../app.css";

afterEach(() => {
  delete document.documentElement.dataset["tod"];
});

test("the backdrop takes the core's tint", async () => {
  const core = { sunTint: () => Promise.resolve({ tint: "dusk" as const }) };

  await render(Backdrop, { core });

  await expect.poll(() => document.documentElement.dataset["tod"]).toBe("dusk");
});

test("a viewer, refused the location, still gets the tint", async () => {
  const viewer = {
    location: () => Promise.resolve({ problem: "auth.forbidden" }),
    sunTint: () => Promise.resolve({ tint: "dawn" as const }),
  };

  await render(Backdrop, { core: viewer });

  await expect.poll(() => document.documentElement.dataset["tod"]).toBe("dawn");
});

test("without a location the backdrop stays indigo", async () => {
  let asked = false;

  const core = {
    sunTint: () => {
      asked = true;

      return Promise.resolve({ tint: null });
    },
  };

  const screen = await render(Backdrop, { core });

  await expect.poll(() => asked).toBe(true);
  expect(document.documentElement.dataset["tod"]).toBeUndefined();
  // kbase's indigo: hue 277.
  expect(
    getComputedStyle(screen.container.querySelector(".bg-spotlight")!).backgroundImage,
  ).toMatch(/oklch\(0\.6 0\.2 277/u);
});

test("each tint has its own spotlight", () => {
  const root = document.documentElement;
  const spotlight = (): string => getComputedStyle(root).getPropertyValue("--spotlight");
  const seen = new Set<string>();

  for (const tint of ["dawn", "noon", "dusk", "night"]) {
    root.dataset["tod"] = tint;
    seen.add(spotlight());
  }

  expect(seen.size).toBe(4);
});
