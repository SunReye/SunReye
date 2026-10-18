import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { motion } from "$lib/motion/tier.svelte";
import AnimatedNumber from "./animated-number.svelte";

// The readout asks the live bus for its default cadence; the bus resolves the
// server URL from SvelteKit's runtime env, which a bare component mount has none of.
vi.mock("$env/dynamic/public", () => ({ env: {} }));

// The readout's text is all a reader sees, so every case reads it back off the
// mounted span. The formatting itself is `animated-number.test.ts`; what is here
// is whether the Tween the component builds around it lands, glides or snaps.

afterEach(() => {
  motion.setting = "auto";
});

const text = (container: HTMLElement) => container.querySelector("span")?.textContent;

test("glides to a new sample and settles on exactly that value", async () => {
  motion.setting = "full";
  const { container, rerender } = await render(AnimatedNumber, {
    value: 0,
    unit: "W",
    intervalMs: 200,
  });
  expect(text(container)).toBe("0");

  await rerender({ value: 1000 });
  // A 230 ms glide (cadence × overshoot, floored at 300): mid-flight it is
  // neither end, which is the drift the tier exists to allow.
  await expect.poll(() => text(container)).not.toBe("0");
  expect(text(container)).not.toBe("1,000");
  await expect.poll(() => text(container), { timeout: 2000 }).toBe("1,000");
});

test("snaps straight to the sample when the motion tier is not full", async () => {
  motion.setting = "lite";
  const { container, rerender } = await render(AnimatedNumber, {
    value: 0,
    unit: "W",
    intervalMs: 5000,
  });

  await rerender({ value: 1000 });
  // A 5 s cadence would glide for 5.75 s; anything but `full` takes none of it.
  await expect.poll(() => text(container), { timeout: 200 }).toBe("1,000");
});

test("snaps while off screen, and still shows the latest value", async () => {
  motion.setting = "full";
  const { container, rerender } = await render(AnimatedNumber, {
    value: 0,
    unit: "W",
    intervalMs: 5000,
    animate: false,
  });

  await rerender({ value: 1000 });
  await expect.poll(() => text(container), { timeout: 200 }).toBe("1,000");
});

test("prints a whole-number unit without decimals, and an unconfigured one with them", async () => {
  motion.setting = "still";
  const watts = await render(AnimatedNumber, { value: 1234.56, unit: "W" });
  expect(text(watts.container)).toBe("1,235");

  const energy = await render(AnimatedNumber, { value: 2, unit: null });
  expect(text(energy.container)).toBe("2.0");
});
