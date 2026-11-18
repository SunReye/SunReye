import { afterEach, expect, test } from "vitest";
import { cdp, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { MOTION_SETTING } from "../motion/tier.ts";
import { motion } from "../motion/tier.svelte.ts";
import DisplaySettings from "./DisplaySettings.svelte";

// Settings › Display's Bewegung row (ADR 21 "Motion setting").

afterEach(async () => {
  motion.setting = "auto";
  motion.lowPower = false;
  motion.remeasure();
  localStorage.clear();
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

/** A loop's dropped frames, judged at once: the shared store has no watch here to settle. */
function strain(): void {
  let now = 3_600_000;

  for (let frame = 0; frame < 400; frame++) motion.frame((now += 50));
}

async function display() {
  const screen = await render(DisplaySettings);

  return { screen, choices: screen.getByRole("group", { name: "Bewegung" }) };
}

test("Bewegung starts on Automatisch and says what the watch measured", async () => {
  const { screen, choices } = await display();

  await expect.element(choices.getByRole("radio", { name: "Automatisch" })).toBeChecked();
  await expect.element(screen.getByText("Auf diesem Gerät gemessen: Voll.")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Neu messen" })).not.toBeInTheDocument();
});

test("a chosen tier holds, is kept per browser, and Automatisch goes back to the watch", async () => {
  const { screen, choices } = await display();

  await userEvent.click(choices.getByRole("radio", { name: "Reduziert" }));

  expect(motion.tier).toBe("lite");
  expect(localStorage.getItem(MOTION_SETTING)).toBe("lite");
  await expect.element(choices.getByRole("radio", { name: "Reduziert" })).toBeChecked();
  await expect
    .element(screen.getByText("Fest gewählt; die Messung ändert sie nicht."))
    .toBeVisible();

  await userEvent.click(choices.getByRole("radio", { name: "Voll" }));
  expect(motion.tier).toBe("full");

  await userEvent.click(choices.getByRole("radio", { name: "Automatisch" }));
  expect(motion.setting).toBe("auto");
});

test("once the watch has stepped down, Neu messen brings the device back to full", async () => {
  const { screen } = await display();

  strain();

  await expect.element(screen.getByText("Auf diesem Gerät gemessen: Reduziert.")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Neu messen" }));

  expect(motion.tier).toBe("full");
  expect(localStorage.getItem("sunreye.motion-strain")).toBeNull();
  await expect.element(screen.getByText("Auf diesem Gerät gemessen: Voll.")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Neu messen" })).not.toBeInTheDocument();
});

test("the off switches hold everything still over a chosen tier, and the row says why", async () => {
  const { screen, choices } = await display();

  await userEvent.click(choices.getByRole("radio", { name: "Voll" }));
  await userEvent.click(screen.getByRole("switch", { name: /^Stromsparen/u }));

  expect(motion.tier).toBe("still");
  await expect.element(screen.getByText("Still, solange Stromsparen an ist.")).toBeVisible();

  await userEvent.click(screen.getByRole("switch", { name: /^Stromsparen/u }));
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });

  await expect
    .element(screen.getByText("Still, weil das System Bewegung reduziert."))
    .toBeVisible();
  expect(motion.tier).toBe("still");
});
