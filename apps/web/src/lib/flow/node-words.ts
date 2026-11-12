// How a 2D flow node reads (ADR 21): its icon, name, direction arrow and state words.
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import BatteryCharging from "@lucide/svelte/icons/battery-charging";
import Car from "@lucide/svelte/icons/car";
import Fuel from "@lucide/svelte/icons/fuel";
import House from "@lucide/svelte/icons/house";
import Sun from "@lucide/svelte/icons/sun";
import UtilityPole from "@lucide/svelte/icons/utility-pole";
import { m } from "../paraglide/messages.js";
import type { Flow, GraphNode, NodeKind, NodeState } from "./schematic.ts";

export const ICONS: Readonly<Record<NodeKind, typeof Sun>> = {
  pv: Sun,
  battery: BatteryCharging,
  load: House,
  generator: Fuel,
  grid: UtilityPole,
  charger: Car,
};

/** Arriving at the inverter points down the page's reading of "in", leaving points up. */
export const ARROWS: Readonly<Record<Flow, typeof Sun | undefined>> = {
  in: ArrowDown,
  out: ArrowUp,
  idle: undefined,
};

const NAMES: Readonly<Record<NodeKind, () => string>> = {
  pv: m.dash_pv,
  battery: m.dash_battery,
  load: m.dash_house,
  generator: m.flow_generator,
  grid: m.detail_grid,
  charger: m.dash_ev,
};

export const STATES: Readonly<Record<NodeState, () => string>> = {
  idle: m.flow_idle,
  producing: m.flow_producing,
  charging: m.flow_charging,
  discharging: m.flow_discharging,
  consuming: m.flow_consuming,
  feeding: m.flow_feeding,
  running: m.flow_running,
  off: m.flow_off,
  import: m.flow_import,
  export: m.flow_export,
  plugged: m.flow_plugged,
};

/** A string's own name, the PV node's string count, else the kind's name. */
export function nodeLabel(node: GraphNode): string {
  if (node.label !== undefined) return node.label;

  return node.strings !== undefined && node.strings > 1
    ? m.flow_pv_strings({ count: node.strings })
    : NAMES[node.kind]();
}
