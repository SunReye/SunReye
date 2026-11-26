import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import SunMark from "./sun-mark.svelte";

test("the mark is v3's flat sun, eight rays around a disc, in the brand colour", async () => {
  const screen = await render(SunMark);
  const mark = screen.getByRole("img", { name: "SunReye" });
  const swatch = document.createElement("div");

  swatch.className = "text-brand";
  document.body.append(swatch);

  await expect.element(mark).toBeVisible();
  expect(mark.element().querySelectorAll("line")).toHaveLength(8);
  expect(mark.element().querySelectorAll("circle")).toHaveLength(1);
  expect(getComputedStyle(mark.element()).color).toBe(getComputedStyle(swatch).color);

  swatch.remove();
});
