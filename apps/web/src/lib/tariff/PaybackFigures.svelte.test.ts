// A figure is the same component as the same figure elsewhere (ADR 21): the payback's euros roll
// up to their value as History's payback does.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import PaybackFigures from "./PaybackFigures.svelte";

// Time is injected: frames and the clock move only when the test says so.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "requestAnimationFrame"] });
});

afterEach(async () => {
  await vi.advanceTimersByTimeAsync(10_000);
  vi.useRealTimers();
});

const PAYBACK = { investment: 12_000, savings: 1200, remaining: 10_800, months: [] };

/** The figure that `term` names, as it shows. */
function figure(container: HTMLElement, term: string): string | undefined {
  const dd = [...container.querySelectorAll("dt")].find(
    (dt) => dt.textContent.trim() === term,
  )?.nextElementSibling;

  return dd instanceof HTMLElement ? dd.innerText.replaceAll(/\s+/gu, " ").trim() : undefined;
}

test("the savings roll up to their value, and what is still open with them", async () => {
  const screen = await render(PaybackFigures, { payback: PAYBACK });

  expect(figure(screen.container, "Ersparnis bisher")).toBe("0,00 €");

  await vi.advanceTimersByTimeAsync(5000);

  expect(figure(screen.container, "Ersparnis bisher")).toBe("1.200,00 €");
  expect(figure(screen.container, "Noch offen")).toBe("10.800,00 €");
});

test("without an investment nothing is open: a dash", async () => {
  const screen = await render(PaybackFigures, {
    payback: { ...PAYBACK, investment: null, remaining: null },
  });

  await vi.advanceTimersByTimeAsync(5000);

  expect(figure(screen.container, "Noch offen")).toBe("–");
});
