// A refusal's haptic (ADR 21), as the builder and its consumer's screens play it beside their alerts.
import { haptics } from "@sunreye/ui/haptics";

/**
 * What the core answered an action of the user's with, passed on. A refusal plays the error haptic
 * as it lands; its alert stands inline beside the action for a fix. A failed read, which no action
 * asked for, is shown silently.
 */
export function answered<T extends object | undefined>(answer: T): T {
  if (answer !== undefined && "problem" in answer) haptics.error();

  return answer;
}

/** A refusal made beside a field, before asking the core: its haptic. */
export function refusedInline(): void {
  haptics.error();
}
