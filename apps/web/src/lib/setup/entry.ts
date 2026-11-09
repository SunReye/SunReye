// What the SPA opens on (ADR 9, 11): sign-in, the first-run setup, or the dashboard.
import type { Core } from "../api/core.ts";
import { sceneLayout, type SceneLayout } from "../live/dashboard.ts";

export type Entry =
  | { readonly screen: "sign-in" }
  /** `signedIn` once the admin is, or Home Assistant's ingress vouches for them. */
  | { readonly screen: "setup"; readonly signedIn: boolean }
  | { readonly screen: "dashboard"; readonly layout: SceneLayout | null };

/**
 * Setup while the core has no admin password, or the admin no device yet; sign-in while signed
 * out; else the dashboard, viewers' too.
 */
export async function entry(
  core: Readonly<Pick<Core, "session" | "devices" | "layout">>,
): Promise<Entry> {
  const session = await core.session();

  if (session?.problem === "auth.setup") return { screen: "setup", signedIn: false };

  if (session?.problem === "auth.required") return { screen: "sign-in" };

  const devices = await core.devices();

  if (!("problem" in devices) && devices.length === 0) return { screen: "setup", signedIn: true };

  return { screen: "dashboard", layout: await sceneLayout(core) };
}
