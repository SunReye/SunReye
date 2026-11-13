import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import PowerNumber from "./power-number.svelte";

// Time is injected: frames and the clock move only when the test says so.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "requestAnimationFrame"] });
});

afterEach(async () => {
  await vi.advanceTimersByTimeAsync(10_000);
  vi.useRealTimers();
});

/** The watts a written power stands for. */
function watts(text: string): number {
  const [n = "", unit] = text.trim().split(/\s+/u);
  const v = Number(n.replace(",", "."));

  return unit === "kW" ? v * 1000 : v;
}

test("a power reads in watts below 1 kW and in kilowatts from it", async () => {
  const screen = await render(PowerNumber, { watts: 10 });

  await vi.advanceTimersByTimeAsync(5000);
  expect(screen.container.textContent?.trim()).toBe("10 W");

  await screen.rerender({ watts: 1000 });
  await vi.advanceTimersByTimeAsync(5000);
  expect(screen.container.textContent?.trim()).toBe("1,0 kW");
});

test("the number keeps rolling across the switch from W to kW", async () => {
  const screen = await render(PowerNumber, { watts: 600 });

  await vi.advanceTimersByTimeAsync(5000);
  await screen.rerender({ watts: 3000 });
  await vi.advanceTimersByTimeAsync(300);

  const between = watts(screen.container.textContent ?? "");
  expect(between).toBeGreaterThan(600);
  expect(between).toBeLessThan(3000);

  await vi.advanceTimersByTimeAsync(5000);
  expect(screen.container.textContent?.trim()).toBe("3,0 kW");
});

test("a unit can carry a suffix and its own style", async () => {
  const screen = await render(PowerNumber, { watts: 450, suffix: " AC", unitClass: "unit" });

  await vi.advanceTimersByTimeAsync(5000);
  expect(screen.container.querySelector(".unit")?.textContent).toBe("W AC");
});
