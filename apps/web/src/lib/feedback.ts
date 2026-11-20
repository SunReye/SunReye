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
 * A refusal with no field or action left on screen to stand beside. One that has stays inline
 * (`setup/Refusal.svelte`).
 */
export function refused({ problem }: Problem): void {
  haptics.error();
  toast.error(problemText(problem));
}
