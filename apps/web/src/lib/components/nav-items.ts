/**
 * Which top-level areas the sidebar offers this viewer.
 *
 * Extracted from `app-sidebar.svelte` because it is the app's visibility
 * policy, not markup: four separate conditions decide it (role, what the
 * engine serves, what the device declares, and an opt-in feature gate), and each one is a way to leak
 * an area to somebody who should not see it. The component maps these ids to a
 * label, an icon and an href and does nothing else.
 *
 * This hides entries; it does NOT authorize. The server enforces every
 * mutation, and `(app)/+layout.svelte` bounces a non-admin who types an
 * admin-only URL. Hiding is about not advertising.
 */

import type { CapabilityName } from "$lib/capabilities";

export type NavItemId = "overview" | "history" | "statistics" | "controls" | "automations";

export type NavAudience = {
  isAdmin: boolean;
  /** Whether the connected engine serves an area at all; a missing one is not offered to anybody. */
  offers: (area: CapabilityName) => boolean;
  /** How many live controls the connected device declares; 0 hides the page. */
  controlCount: number;
  /**
   * The automations master gate (Settings → Automations). Automations are
   * experimental and write inverter registers, so they stay out of the nav
   * entirely until an admin has switched them on — see `$lib/automations-gate`.
   */
  automationsEnabled: boolean;
};

export function navItemIds({
  isAdmin,
  offers,
  controlCount,
  automationsEnabled,
}: NavAudience): NavItemId[] {
  const ids: NavItemId[] = ["overview"];
  if (offers("history")) ids.push("history");
  if (offers("statistics")) ids.push("statistics");
  // Both admin-only areas; the gate is an extra condition on top of the role,
  // never a substitute for it.
  if (isAdmin && offers("controls") && controlCount > 0) ids.push("controls");
  if (isAdmin && offers("automations") && automationsEnabled) ids.push("automations");
  return ids;
}
