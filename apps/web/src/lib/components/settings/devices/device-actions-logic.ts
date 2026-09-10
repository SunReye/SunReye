/**
 * WHAT A DEVICE ROW OFFERS, decided once, in a testable place.
 *
 * The rule used to live inside `./device-actions.svelte` as a `{#if}` chain, and
 * it said one thing: a MODBUS row gets the controls, everything else gets a
 * link. That was correct while the server refused any `PATCH` on a coded or a
 * virtual row (#213 — an untouched Edit, seeded on the plant's first gateway,
 * bound the loadpoint or the optimizer to it). #219 narrowed that refusal to
 * TOPOLOGY — which gateway, which slave id, which driver, what it counts as —
 * so `name` and `retired` are writable on those rows now, and a row that cannot
 * be renamed is no longer a rule, it is a missing button.
 *
 * A LIST, not a flag per control. The component renders whatever comes back, in
 * order, through ONE loop: a flag per control put a branch per control in the
 * template, and the template became the most complex thing on the panel.
 *
 * The two dialogs are different on purpose. `edit` opens the ADDRESSING dialog
 * (gateway, unit id, profile) and only a Modbus row has any of those; `rename`
 * opens a name-only dialog, which is everything the narrowed gate allows.
 */

import type { DeviceView } from "./device-types";

export type DeviceActionId = "restore" | "edit" | "rename" | "retire";

export type DeviceAction = {
  id: DeviceActionId;
  /**
   * Rendered, but refused, with the reason as its hint. Retiring the polled
   * device would silence the plant — and HIDING the control takes the
   * explanation with it, so it stays, disabled.
   */
  blocked: boolean;
};

const act = (id: DeviceActionId, blocked = false): DeviceAction => ({ id, blocked });

export function actionsFor(device: DeviceView): readonly DeviceAction[] {
  const retired = device.retiredAt !== null;
  if (device.kind === "modbus") {
    // Re-point the polled device rather than retiring it — which Edit does.
    return retired ? [act("restore")] : [act("edit"), act("retire", device.state === "polling")];
  }
  // A coded row: what the narrowed gate allows, and nothing else. There used to
  // be a "Configure" link here for the integrations that had a page — it pointed
  // at `/settings/mqtt`, and what lived there is now an integration ROW in this
  // device's own connection group, a few lines up, with its own Edit. The link
  // had nowhere left to lead but the page the operator is already reading.
  if (device.kind === "coded") return retired ? [act("restore")] : [act("rename"), act("retire")];
  // Virtual: the optimizer. Renaming is safe. Retiring it would stop the
  // control loop from a control that looks like a label, so it is withheld —
  // the Automations panel is where that decision belongs.
  if (device.kind === "virtual") return retired ? [act("restore")] : [act("rename")];
  return [];
}
