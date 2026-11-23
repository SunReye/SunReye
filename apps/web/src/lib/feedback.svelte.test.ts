import { toast } from "svelte-sonner";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../app.css";
import { Toaster } from "./components/ui/sonner/index.js";
import { answered, confirmed, refused, refusedInline } from "./feedback.ts";
import { haptics } from "@sunreye/ui/haptics";
import Refusal from "./setup/Refusal.svelte";

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

test("a refused answer plays the error haptic once and toasts nothing; a taken one is silent", () => {
  const error = vi.spyOn(haptics, "error");
  const toasted = vi.spyOn(toast, "error");
  const taken = { id: 5 };

  expect(answered(taken)).toBe(taken);
  expect(error).not.toHaveBeenCalled();

  const no = { problem: "request.route" } as const;

  expect(answered(no)).toBe(no);
  expect(error).toHaveBeenCalledOnce();
  expect(toasted).not.toHaveBeenCalled();
});

test("a refusal the SPA makes beside a field plays the error haptic once", () => {
  const error = vi.spyOn(haptics, "error");

  refusedInline();

  expect(error).toHaveBeenCalledOnce();
});

test("a refusal shown inline is silent: the action it answers played the haptic", async () => {
  const error = vi.spyOn(haptics, "error");
  const screen = await render(Refusal, { refused: { problem: "request.route" } });

  await expect.element(screen.getByRole("alert")).toBeVisible();
  await screen.rerender({ refused: { problem: "request.route" } });

  expect(error).not.toHaveBeenCalled();
});
