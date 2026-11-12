import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Backdrop from "./Backdrop.svelte";
import "../../app.css";

const tints = ["dawn", "noon", "dusk", "night"];

afterEach(() => {
  delete document.documentElement.dataset["tod"];
});

test("with the plant's location the backdrop takes the sun's tint", async () => {
  const core = { location: () => Promise.resolve({ latitude: 52.52, longitude: 13.4 }) };

  await render(Backdrop, { core });

  await expect.poll(() => document.documentElement.dataset["tod"]).toBeOneOf(tints);
});

test("without a location the backdrop stays indigo", async () => {
  let asked = false;

  const core = {
    location: () => {
      asked = true;

      return Promise.resolve({ problem: "auth.forbidden" });
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

  for (const tint of tints) {
    root.dataset["tod"] = tint;
    seen.add(spotlight());
  }

  expect(seen.size).toBe(4);
});
