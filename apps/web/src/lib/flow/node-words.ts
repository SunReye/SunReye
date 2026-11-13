// How a 2D flow node reads (ADR 21): its icon, name, direction arrow and state words.
import ArrowDown from "@lucide/svelte/icons/arrow-down";
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import { KIND_NAMES } from "../equipment-kinds.ts";
import { m } from "../paraglide/messages.js";
import type { Flow, GraphNode, NodeState } from "./schematic.ts";

/** Arriving at the inverter points down the page's reading of "in", leaving points up. */
export const ARROWS: Readonly<Record<Flow, typeof ArrowUp | undefined>> = {
  in: ArrowDown,
  out: ArrowUp,
  idle: undefined,
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
    : KIND_NAMES[node.kind]();
}
