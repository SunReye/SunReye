import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { motion } from "../../../../../../packages/builder/src/motion/tier.svelte.ts";
import Meter from "./Meter.svelte";

afterEach(() => {
  motion.lowPower = false;
});

function glide(): string {
  return getComputedStyle(document.querySelector('[data-slot="progress-indicator"]')!)
    .transitionDuration;
}

test("the gauge glides slightly longer than a tick", async () => {
  await render(Meter, { label: "Autarkie", value: 40, colour: "red" });

  expect(glide()).toBe("1.15s");
});

test("low power steps the gauge", async () => {
  motion.lowPower = true;

  await render(Meter, { label: "Autarkie", value: 40, colour: "red" });

  expect(glide()).toBe("0s");
});
