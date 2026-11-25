// Test harness: a toast's life on the test's clock. Sonner closes a toast, and removes a dismissed
// one, on `setTimeout`: on the wall clock a loaded page can miss a toast before it looks.
import { toast } from "svelte-sonner";
import { vi } from "vitest";
import { stepUntil } from "../motion/clock.harness.ts";

/** Puts the toasts' timers on the test's clock: a toast stays until the test lets it go. */
export function holdToasts(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

/** Dismisses every toast and runs the test's clock on until all have left; then the wall clock. */
export async function clearToasts(): Promise<void> {
  toast.dismiss();

  if (vi.isFakeTimers())
    await stepUntil(
      () => document.querySelector("[data-sonner-toast]") === null,
      () => {
        vi.advanceTimersByTime(100);
      },
    );

  vi.useRealTimers();
}
