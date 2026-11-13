// A setting's or quantity's name as Settings shows it: the role in the viewer's language, else the profile's
// name, else its key spelled as words; never the key itself.
import type { EditableSetting } from "../components/value-editor/editable.ts";
import { m } from "../paraglide/messages.js";

const ROLES: Readonly<Record<string, () => string>> = {
  "battery.max_charge_current": m.role_battery_max_charge_current,
  "battery.max_discharge_current": m.role_battery_max_discharge_current,
  "battery.grid_charge": m.role_battery_grid_charge,
  "battery.discharge_lock": m.role_battery_discharge_lock,
  "battery.time_of_use.enabled": m.role_battery_time_of_use_enabled,
  work_mode: m.role_work_mode,
};

const FIELDS: Readonly<Record<string, () => string>> = {
  start: m.controls_field_start,
  power: m.controls_field_power,
  soc: m.controls_field_soc,
  grid_charge: m.controls_field_grid_charge,
};

/** A time-of-use slot's setting: `<namespace>.time_of_use.<slot>.<field>`. */
const SLOT = /\.time_of_use\.(\d+)\.([^.]+)$/u;

/** The key as words: `inverter.reactive_power_mode` reads "Inverter reactive power mode". */
function words(key: string): string {
  const spaced = key
    .replaceAll(".", " ")
    .replaceAll(/([a-z\d])([A-Z])/gu, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function settingLabel(setting: Pick<EditableSetting, "key" | "name">): string {
  const role = ROLES[setting.key];

  if (role) return role();

  const [, n, field] = SLOT.exec(setting.key) ?? [];
  const fieldName = field === undefined ? undefined : FIELDS[field];

  if (n !== undefined && fieldName) return m.role_slot({ n, field: fieldName() });

  return setting.name ?? words(setting.key);
}
