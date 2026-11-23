import { userPrefersMode } from "mode-watcher";
import { afterEach, expect, test } from "vitest";
import { cdp, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { HAPTICS } from "@sunreye/ui/haptics";
import { language } from "../i18n/language.svelte.ts";
import { LOW_POWER } from "../../../../../packages/builder/src/motion/tier.ts";
import { motion } from "../../../../../packages/builder/src/motion/tier.svelte.ts";
import { QUALITY, quality } from "../../../../../packages/builder/src/scene/quality.svelte.ts";
import DisplaySettings from "./DisplaySettings.svelte";

afterEach(async () => {
  quality.choice = "auto";
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

  await userEvent.click(screen.getByRole("switch", { name: /^Stromsparen/u }));

  expect(motion.tier).toBe("still");
  expect(localStorage.getItem(LOW_POWER)).toBe("on");
});

test("the haptics switch is kept per browser", async () => {
  localStorage.setItem(HAPTICS, "on");
  const screen = await display();
  const haptics = screen.getByRole("switch", { name: /^Haptisches Feedback/u });

  await expect.element(haptics).toBeChecked();
  await userEvent.click(haptics);

  await expect.element(haptics).not.toBeChecked();
  expect(localStorage.getItem(HAPTICS)).toBe("off");
});

test("low power and reduced motion force haptics off and say why", async () => {
  localStorage.setItem(HAPTICS, "on");
  const screen = await display();
  const haptics = screen.getByRole("switch", { name: /^Haptisches Feedback/u });

  await userEvent.click(screen.getByRole("switch", { name: /^Stromsparen/u }));

  await expect.element(haptics).not.toBeChecked();
  await expect.element(haptics).toBeDisabled();
  await expect.element(screen.getByText("Aus, solange Stromsparen an ist.")).toBeVisible();

  await userEvent.click(screen.getByRole("switch", { name: /^Stromsparen/u }));
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });

  await expect.element(haptics).toBeDisabled();
  await expect.element(screen.getByText("Aus, weil das System Bewegung reduziert.")).toBeVisible();
});

test("the 3D quality offers Auto and four levels, and the choice is kept per browser", async () => {
  const screen = await display();
  const levels = screen.getByRole("group", { name: "3D-Qualität" });

  for (const name of ["Auto", "Niedrig", "Mittel", "Hoch", "Ultra"]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one after the other.
    await expect.element(levels.getByRole("radio", { name })).toBeVisible();
  }

  await expect.element(levels.getByRole("radio", { name: "Auto" })).toBeChecked();

  await userEvent.click(levels.getByRole("radio", { name: "Ultra" }));

  expect(quality.choice).toBe("ultra");
  expect(localStorage.getItem(QUALITY)).toBe("ultra");
  await expect.element(levels.getByRole("radio", { name: "Ultra" })).toBeChecked();
});

test("on Auto the row says which level this device draws; a chosen level needs no saying", async () => {
  const screen = await display();

  // No capable GPU seen here: Auto starts at Mittel.
  await expect
    .element(screen.getByText("Auto zeichnet auf diesem Gerät derzeit Mittel."))
    .toBeVisible();

  await userEvent.click(
    screen.getByRole("group", { name: "3D-Qualität" }).getByRole("radio", { name: "Hoch" }),
  );

  await expect.element(screen.getByText("Wie scharf das 3D-Haus gezeichnet wird.")).toBeVisible();
});

test("with low power on, the row says the 3D scene is not shown", async () => {
  const screen = await display();

  await userEvent.click(screen.getByRole("switch", { name: /^Stromsparen/u }));

  await expect.element(screen.getByText("Stromsparen zeigt 2D statt 3D.")).toBeVisible();
});
