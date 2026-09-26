/**
 * The first-run journey, as one list both pages draw.
 *
 * `/onboarding` creates the administrator; `/setup` picks the profile, saves the
 * connection and activates it. Two routes, one rail: the account step is shown
 * done on `/setup` so the operator sees where they are in the whole thing.
 */

import * as m from "$lib/paraglide/messages";

export type SetupStep = "account" | "profile" | "connect" | "activate";

export const SETUP_STEPS: readonly { key: SetupStep; label: () => string }[] = [
  { key: "account", label: m.setup_step_account },
  { key: "profile", label: m.setup_step_profile },
  { key: "connect", label: m.setup_step_connection },
  { key: "activate", label: m.setup_step_activate },
];

/** Where `step` sits on the rail. */
export function stepIndex(step: SetupStep): number {
  return SETUP_STEPS.findIndex((s) => s.key === step);
}
