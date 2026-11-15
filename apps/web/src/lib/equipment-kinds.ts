// The plant's equipment kinds: one vocabulary for 3D label chips and 2D flow nodes (ADR 20, 21).
import BatteryCharging from "@lucide/svelte/icons/battery-charging";
import Car from "@lucide/svelte/icons/car";
import Cpu from "@lucide/svelte/icons/cpu";
import Fuel from "@lucide/svelte/icons/fuel";
import House from "@lucide/svelte/icons/house";
import Sun from "@lucide/svelte/icons/sun";
import UtilityPole from "@lucide/svelte/icons/utility-pole";
import { m } from "./paraglide/messages.js";

/** A string is one of the PV's strings; `pv` is all of them. */
export type EquipmentKind =
  | "pv"
  | "string"
  | "inverter"
  | "battery"
  | "grid"
  | "house"
  | "generator"
  | "ev";

export const KIND_ICONS: Readonly<Record<EquipmentKind, typeof Sun>> = {
  pv: Sun,
  string: Sun,
  inverter: Cpu,
  battery: BatteryCharging,
  grid: UtilityPole,
  house: House,
  generator: Fuel,
  ev: Car,
};

/** A kind's name; a string's own name wins over its kind's. */
export const KIND_NAMES: Readonly<Record<EquipmentKind, () => string>> = {
  pv: m.dash_pv,
  string: m.dash_pv,
  inverter: m.detail_inverter,
  battery: m.dash_battery,
  grid: m.detail_grid,
  house: m.dash_house,
  generator: m.flow_generator,
  ev: m.dash_ev,
};
