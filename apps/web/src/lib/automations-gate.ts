/**
 * "Has anyone switched the automations on yet?" — asked once, for the nav.
 *
 * Automations are EXPERIMENTAL: they write registers on a grid-tied inverter on
 * the user's behalf. Until an admin has turned the master gate on in
 * Settings → Automations, the feature does not advertise itself in the sidebar
 * at all — an unexplored menu entry is an invitation, and this one leads to a
 * page whose whole subject is letting software actuate the plant.
 *
 * The gate is only ever OFF-by-default: every path that cannot answer the
 * question (not an admin, request failed, malformed body, onboarding-only boot
 * where the route does not exist) resolves to `false`. A nav entry that appears
 * because a fetch blipped is the failure mode worth designing against; a nav
 * entry that stays hidden for one poll is not.
 *
 * The reactive singleton lives in ./automations-gate.svelte.ts beside this;
 * what is testable without a rune scheduler is the READ.
 */

/** The slice of `GET /api/settings/automations` the nav actually reads. */
// fallow-ignore-next-line unused-type -- the payload shape the gate parses, named so automations-gate.test.ts can state it; web test files aren't traced as consumers
export type AutomationsGatePayload = { enabled?: unknown };

/**
 * Resolve the master gate from whatever the settings endpoint handed back.
 *
 * Deliberately strict about the type: `enabled` is a boolean or the gate is
 * off. `readSetting` on the server safe-parses a malformed row back to its
 * default with no log (a known trap), so a body that has drifted is exactly the
 * case where the client must not guess "probably on".
 */
// fallow-ignore-next-line unused-export -- the parse boundary itself, asserted directly by automations-gate.test.ts (empty body, truthy non-boolean, `""`); web test files aren't traced as consumers
export function automationsGateFrom(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  return (payload as AutomationsGatePayload).enabled === true;
}

/**
 * Fetch the gate, never throwing.
 *
 * `isAdmin` is checked here rather than at the call site because the endpoint
 * is `requireAdmin`: asking as a non-admin is a guaranteed 401, and the answer
 * for them is `false` regardless.
 */
export async function loadAutomationsGate(
  isAdmin: boolean,
  fetchConfig: () => Promise<unknown>,
): Promise<boolean> {
  if (!isAdmin) return false;
  try {
    return automationsGateFrom(await fetchConfig());
  } catch {
    return false;
  }
}
