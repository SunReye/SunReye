// A control's write through ADR 7's funnel, as the value editor and the schedule switch apply it.
import { toast } from "svelte-sonner";
import type { Core } from "../api/core";
import type { Outcome } from "../components/value-editor/editable.ts";
import { haptics } from "../haptics.ts";
import { m } from "../paraglide/messages.js";
import { editorOutcome } from "../settings/outcomes";
import type { Control } from "./groups.ts";

export interface Applying {
  readonly core: Readonly<Pick<Core, "write">>;
  /** A control's current value as text. */
  readonly text: (control: Control) => string;
  /** Reads the device again after a write, whatever its outcome. */
  readonly onwritten: (control: Control) => Promise<void>;
}

/** Writes `next`, reads the device again, then plays the outcome's haptic and toasts a confirmation. */
export async function apply(
  on: Readonly<Applying>,
  written: Control,
  next: number,
): Promise<Outcome> {
  const before = on.text(written);
  const result = await on.core.write(written.device, written.setting.key, next);
  const outcome = editorOutcome(result);

  await on.onwritten(written);

  if (outcome.kind === "confirmed") {
    haptics.success();
    toast.success(`${written.setting.name ?? written.setting.key}: ${on.text(written)}`, {
      description: m.controls_confirmed({ before }),
    });
  } else haptics.error();

  return outcome;
}
