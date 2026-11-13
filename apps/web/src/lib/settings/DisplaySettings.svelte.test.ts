import { userPrefersMode } from "mode-watcher";
import { afterEach, expect, test } from "vitest";
import { cdp, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { HAPTICS } from "../haptics.ts";
import { language } from "../i18n/language.svelte.ts";
import { LOW_POWER } from "../motion/tier.ts";
import { motion } from "../motion/tier.svelte.ts";
import DisplaySettings from "./DisplaySettings.svelte";

afterEach(async () => {
  motion.lowPower = false;
  await language.choose("de");
  localStorage.clear();
  userPrefersMode.current = "dark";
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

function display() {
  return render(DisplaySettings);
}

// The root layout's ModeWatcher applies and keeps the choice (layout.svelte.test.ts).
test("the theme switches to light and back to dark", async () => {
  const screen = await display();
  const theme = screen.getByRole("group", { name: "Erscheinungsbild" });

  await userEvent.click(theme.getByRole("radio", { name: "Hell" }));
  await expect.poll(() => userPrefersMode.current).toBe("light");

  await userEvent.click(theme.getByRole("radio", { name: "Dunkel" }));
  await expect.poll(() => userPrefersMode.current).toBe("dark");
});

test("the language is chosen by its own name", async () => {
  const screen = await display();

  await userEvent.click(
    screen.getByRole("group", { name: "Sprache" }).getByRole("radio", { name: "English" }),
  );

  expect(language.current).toBe("en");
});

test("the low-power switch forces the still tier and is kept", async () => {
  const screen = await display();

  await userEvent.click(screen.getByRole("checkbox", { name: /^Stromsparen/u }));

  expect(motion.tier).toBe("still");
  expect(localStorage.getItem(LOW_POWER)).toBe("on");
});

test("the haptics switch is kept per browser", async () => {
  localStorage.setItem(HAPTICS, "on");
  const screen = await display();
  const haptics = screen.getByRole("checkbox", { name: /^Haptisches Feedback/u });

  await expect.element(haptics).toBeChecked();
  await userEvent.click(haptics);

  await expect.element(haptics).not.toBeChecked();
  expect(localStorage.getItem(HAPTICS)).toBe("off");
});

test("low power and reduced motion force haptics off and say why", async () => {
  localStorage.setItem(HAPTICS, "on");
  const screen = await display();
  const haptics = screen.getByRole("checkbox", { name: /^Haptisches Feedback/u });

  await userEvent.click(screen.getByRole("checkbox", { name: /^Stromsparen/u }));

  await expect.element(haptics).not.toBeChecked();
  await expect.element(haptics).toBeDisabled();
  await expect.element(screen.getByText("Aus, solange Stromsparen an ist.")).toBeVisible();

  await userEvent.click(screen.getByRole("checkbox", { name: /^Stromsparen/u }));
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });

  await expect.element(haptics).toBeDisabled();
  await expect.element(screen.getByText("Aus, weil das System Bewegung reduziert.")).toBeVisible();
});
