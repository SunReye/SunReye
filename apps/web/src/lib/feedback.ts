// Transient feedback (ADR 21): a toast and its haptic, always together.
import { toast } from "svelte-sonner";
import type { Problem } from "./api/client.ts";
import { haptics } from "./haptics.ts";
import { problemText } from "./i18n/problems.ts";

/** What an action did and needs no answer: "Gespeichert", "Entfernt", a confirmed write. */
export function confirmed(text: string, options: { readonly description?: string } = {}): void {
  haptics.success();
  toast.success(text, options);
}

/**
 * What the core answered an action of the user's with, passed on. A refusal plays the error haptic
 * as it lands; its alert stands inline beside the action (`setup/Refusal.svelte`) for a fix. A
 * failed read, which no action asked for, is shown silently.
 */
export function answered<T extends object | undefined>(answer: T): T {
  if (answer !== undefined && "problem" in answer) haptics.error();

  return answer;
}

/** A refusal the SPA itself makes beside a field, before asking the core: its haptic. */
export function refusedInline(): void {
  haptics.error();
}

/**
 * A refusal with no field or action left on screen to stand beside. One that has stays inline
 * (`setup/Refusal.svelte`).
 */
export function refused({ problem }: Problem): void {
  haptics.error();
  toast.error(problemText(problem));
}
