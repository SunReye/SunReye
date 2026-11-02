import { core } from "$lib/core-api";

/**
 * Whether the instance still needs first-run setup (no accounts yet). Drives the
 * onboarding gate: the first visitor creates the admin, after which registration
 * is closed and `/onboarding` bounces to `/login`.
 */
export async function needsSetup(): Promise<boolean> {
  const { data } = await core.GET("/api/setup-status");
  return data?.needsSetup ?? false;
}

/**
 * Whether the instance still needs a first-run **profile** chosen. When true the
 * server booted onboarding-only (no active inverter profile), so the workspace
 * gate routes the admin to `/setup` to pick one, test the connection, and
 * restart into the full API.
 */
async function needsProfile(): Promise<boolean> {
  const { data } = await core.GET("/api/profile-status");
  return data?.needsProfile ?? false;
}

/**
 * Where a first-run instance must go, in strict precedence:
 * - `setup-account` — no admin exists yet → create it at `/onboarding`.
 * - `setup-profile` — admin exists but no active profile → pick one at `/setup`.
 * - `ready` — fully configured → the workspace.
 *
 * The account step wins over the profile step, so the two gates (`/` and
 * `/setup`) never bounce a user into profile setup before an admin exists.
 */
export type FirstRunGate = "setup-account" | "setup-profile" | "ready";

export async function firstRunGate(): Promise<FirstRunGate> {
  if (await needsSetup()) return "setup-account";
  if (await needsProfile()) return "setup-profile";
  return "ready";
}
