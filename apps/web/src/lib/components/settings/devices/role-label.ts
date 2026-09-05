import * as m from "$lib/paraglide/messages";
import type { AddableRole } from "./device-types";

const ROLE_LABELS: Record<AddableRole, () => string> = {
  inverter: m.devices_role_inverter,
  meter: m.devices_role_meter,
  charger: m.devices_role_charger,
  controller: m.devices_role_controller,
};

/** The translated name of a role; a role this build does not know shows as itself. */
export function roleLabel(role: string): string {
  return (ROLE_LABELS as Partial<Record<string, () => string>>)[role]?.() ?? role;
}
