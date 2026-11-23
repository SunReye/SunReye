import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../../app.css";
import TimeWheels from "../../../../../../packages/builder/src/components/value-editor/time-wheels.svelte";

test("the minute wheel follows a changed step", async () => {
  const screen = await render(TimeWheels, { step: 5, now: null, onlive: () => {} });
  const minute = page.getByRole("spinbutton", { name: "Minute" });

  await expect.element(minute).toHaveAttribute("aria-valuemax", "55");

  await screen.rerender({ step: 15 });

  await expect.element(minute).toHaveAttribute("aria-valuemax", "45");
});
