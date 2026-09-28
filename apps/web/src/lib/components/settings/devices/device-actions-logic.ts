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

import * as m from "$lib/paraglide/messages";

import type { DeviceView } from "./device-types";

export type DeviceActionId = "restore" | "edit" | "rename" | "retire" | "delete";

export type DeviceAction = {
  id: DeviceActionId;
  /**
   * Rendered, but refused, with the reason as its hint. Retiring or deleting
   * the polled device would silence the plant — and HIDING the control takes
   * the explanation with it, so it stays, disabled.
   */
  blocked: boolean;
  /**
   * `primary` is the one button the row shows; `menu` goes behind its overflow
   * menu. One visible control keeps a phone row to a single line — two stacked
   * full-width buttons per device put three devices on a screen.
   */
  placement: "primary" | "menu";
};

const primary = (id: DeviceActionId): DeviceAction => ({
  id,
  blocked: false,
  placement: "primary",
});
const menu = (id: DeviceActionId, blocked = false): DeviceAction => ({
  id,
  blocked,
  placement: "menu",
});

/**
 * DELETE is offered on every Modbus and coded row, retired or not, because the
 * server is the one that knows whether it may go: a device that ever recorded a
 * reading is refused (`field: "history"`, the RESTRICT foreign keys under every
 * reading) and the dialog then offers retiring instead. Asking up front would
 * mean scanning years of readings to draw a roster.
 */
export function actionsFor(device: DeviceView): readonly DeviceAction[] {
  const retired = device.retiredAt !== null;
  if (device.kind === "modbus") {
    if (retired) return [primary("restore"), menu("delete")];
    // Re-point the polled device rather than retiring it — which Edit does.
    const polled = device.state === "polling";
    return [primary("edit"), menu("retire", polled), menu("delete", polled)];
  }
  // A coded row: what the narrowed gate allows, and nothing else. There used to
  // be a "Configure" link here for the integrations that had a page — it pointed
  // at `/settings/mqtt`, and what lived there is now an integration ROW in this
  // device's own connection group, a few lines up, with its own Edit.
  if (device.kind === "coded") {
    return retired
      ? [primary("restore"), menu("delete")]
      : [primary("rename"), menu("retire"), menu("delete")];
  }
  // Virtual: the optimizer. Renaming is safe. Retiring it would stop the
  // control loop from a control that looks like a label, and deleting it is
  // refused by the server — it registers itself on boot.
  if (device.kind === "virtual") return [primary(retired ? "restore" : "rename")];
  return [];
}

/** What each control is called — shared by the row's button and its menu. */
export const ACTION_LABEL: Record<DeviceActionId, () => string> = {
  restore: m.devices_action_restore,
  edit: m.devices_action_edit,
  rename: m.devices_action_rename,
  retire: m.devices_action_retire,
  delete: m.devices_action_delete,
};
