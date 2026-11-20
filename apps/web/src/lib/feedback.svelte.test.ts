import { toast } from "svelte-sonner";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../app.css";
import { Toaster } from "./components/ui/sonner/index.js";
import { confirmed, refused } from "./feedback.ts";
import { haptics } from "./haptics.ts";

/** The toast showing `text`. */
async function toastOf(text: string): Promise<HTMLElement | null> {
  await expect.element(page.getByText(text)).toBeVisible();

  return page.getByText(text).element().closest<HTMLElement>("[data-sonner-toast]");
}

afterEach(() => {
  toast.dismiss();
  vi.restoreAllMocks();
});

test("a confirmed action toasts its success and plays the success haptic once", async () => {
  const success = vi.spyOn(haptics, "success");
  const error = vi.spyOn(haptics, "error");

  await render(Toaster);
  confirmed("Gespeichert", { description: "vorher 80 A" });

  const shown = await toastOf("Gespeichert");

  expect(shown?.dataset["type"]).toBe("success");
  expect(shown?.textContent).toContain("vorher 80 A");
  expect(success).toHaveBeenCalledOnce();
  expect(error).not.toHaveBeenCalled();
});

test("a refusal with nowhere to stand inline toasts its problem and plays the error haptic once", async () => {
  const success = vi.spyOn(haptics, "success");
  const error = vi.spyOn(haptics, "error");

  await render(Toaster);
  refused({ problem: "request.route" });

  const shown = await toastOf("Diese Adresse gibt es nicht.");

  expect(shown?.dataset["type"]).toBe("error");
  expect(error).toHaveBeenCalledOnce();
  expect(success).not.toHaveBeenCalled();
});
