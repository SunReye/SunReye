// What the app shell renders for the current access / first-run state. Kept out
// of the layout markup so the state machine is one readable decision per step
// (and unit-testable) instead of a nested {#if} chain.
import type { FirstRunGate } from "$lib/setup";
import * as m from "$lib/paraglide/messages";

/**
 * Either the workspace, or a centred status message. `text` stays a function so
 * the message resolves at render time, exactly as an inline template call did.
 */
export type AppView = { kind: "shell" } | { kind: "message"; text: () => string };

const loading: AppView = { kind: "message", text: m.app_loading };

/**
 * Logged-out visitor. `anonAllowed` is null until the public-dashboard flag has
 * been probed — show the loading state rather than flashing a login redirect.
 */
function anonView(anonAllowed: boolean | null): AppView {
  if (anonAllowed === null) return loading;
  if (anonAllowed) return { kind: "shell" };
  return { kind: "message", text: m.app_redirecting_login };
}

/**
 * Authenticated visitor. The first-run gate is null until it resolves; anything
 * other than `ready` means the layout is redirecting to onboarding or setup.
 */
function gateView(gate: FirstRunGate | null): AppView {
  if (gate === null) return loading;
  if (gate !== "ready") return { kind: "message", text: m.app_redirecting };
  return { kind: "shell" };
}

/** Access model first (pending → anonymous → authenticated), then the gate. */
export function resolveView(state: {
  pending: boolean;
  authed: boolean;
  anonAllowed: boolean | null;
  gate: FirstRunGate | null;
}): AppView {
  if (state.pending) return loading;
  if (!state.authed) return anonView(state.anonAllowed);
  return gateView(state.gate);
}
