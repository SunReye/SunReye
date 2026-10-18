import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import AutomationCard from "./automation-card.svelte";

afterEach(async () => {
  await page.viewport(1280, 800);
});

// Measured at 412px before the fix: the card's header grid sized its implicit
// `auto` column to the max-content of the description, a 458px track inside a
// 380px card, and the text ran off the right edge. The page shell clips
// horizontal overflow, so nobody saw a scrollbar — only cut-off text.
test("on a 412px phone the card's text stays inside the card", async () => {
  await page.viewport(412, 900);
  render(AutomationCard, {
    href: "/automations/peak-shaving",
    title: "PV-Spitzenkappung & Prognoseladen",
    description:
      "Hält die Einspeisung unter der Netzeinspeisegrenze, indem der Akku in den Mittagsstunden lädt.",
    state: "shadow",
  });

  const link = page.getByRole("link").element();
  const card = link.firstElementChild!.getBoundingClientRect();
  expect(card.right).toBeLessThanOrEqual(412);

  const description = page.getByText(/Hält die Einspeisung/).element();
  expect(description.getBoundingClientRect().right).toBeLessThanOrEqual(card.right);
  // The badge and the caret beside the title are inside the card too.
  const badge = page.getByText("Shadow", { exact: false }).element();
  expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(card.right);
});
