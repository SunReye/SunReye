/**
 * Run-state presentation shared by the automations index and the detail
 * status panel, so a badge means the same thing in both places.
 */

import * as m from "$lib/paraglide/messages";
import type { PeakShavingRunState } from "$lib/automations";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export const STATE_LABEL: Record<PeakShavingRunState, () => string> = {
  active: m.automation_state_active,
  shadow: m.automation_state_shadow,
  simulating: m.automation_state_simulating,
  idle: m.automation_state_idle,
  blocked: m.automation_state_blocked,
  stale: m.automation_state_stale,
  disabled: m.automation_state_disabled,
};

export const STATE_VARIANT: Record<PeakShavingRunState, BadgeVariant> = {
  active: "default",
  // Deliberately not `default`: a dry run must not look like it is steering.
  shadow: "secondary",
  // Same rule for the switched-off simulation.
  simulating: "secondary",
  idle: "secondary",
  blocked: "destructive",
  stale: "destructive",
  disabled: "outline",
};
