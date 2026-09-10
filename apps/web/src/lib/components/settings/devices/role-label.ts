import * as m from "$lib/paraglide/messages";

/**
 * Every role a device row may carry — the addable ones AND the virtual
 * `optimizer`, which registers itself and is never offered in the Add dialog.
 * Keyed by string rather than by `AddableRole` for exactly that reason: the
 * optimizer's badge read `optimizer` in the roster because it had no label and
 * no place in the addable list either (#213).
 */
const ROLE_LABELS: Record<string, () => string> = {
  inverter: m.devices_role_inverter,
  meter: m.devices_role_meter,
  charger: m.devices_role_charger,
  controller: m.devices_role_controller,
  optimizer: m.devices_role_optimizer,
};

/** The translated name of a role; a role this build does not know shows as itself. */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role]?.() ?? role;
}
