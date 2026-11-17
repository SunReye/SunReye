// How a measurement point reads in setup: the 2D flow's icon, energy colour and state words (ADR 21).
import type { PointDraft } from "../api/core.ts";
import { flowColour, roleFlow } from "../energy-colours.ts";
import { KIND_ICONS, type EquipmentKind } from "../equipment-kinds.ts";
import type { NodeState } from "../flow/schematic.ts";
import { m } from "../paraglide/messages.js";
import { seriesName } from "../roles.ts";
import { ROOT } from "./topology.ts";

interface Look {
  readonly kind: EquipmentKind;
  readonly word: () => string;
  /** The state its power reads as: positive first, then negative. */
  readonly states: readonly [NodeState, NodeState];
}

const LOOKS = new Map<string, Look>([
  [ROOT, { kind: "grid", word: m.topology_root, states: ["import", "export"] }],
  ["pv.power", { kind: "pv", word: m.role_pv, states: ["producing", "consuming"] }],
  ["generator.power", { kind: "generator", word: m.role_generator, states: ["running", "idle"] }],
  ["battery.power", { kind: "battery", word: m.role_battery, states: ["charging", "discharging"] }],
  ["load.power", { kind: "house", word: m.role_load, states: ["consuming", "feeding"] }],
  ["backup.power", { kind: "house", word: m.role_backup, states: ["consuming", "feeding"] }],
  ["ev.charge.power", { kind: "ev", word: m.role_ev, states: ["charging", "idle"] }],
]);

/** The power role a point is measured by; the root is the grid's even before a meter claims it. */
export function roleOf(point: PointDraft): string {
  return point.parent === null || point.parent === undefined
    ? ROOT
    : (point.claims[0]?.role ?? ROOT);
}

/** A role's plain word, the name a new point starts with. */
export function roleWord(role: string): string {
  return LOOKS.get(role)?.word() ?? seriesName(role);
}

export function iconOf(role: string): (typeof KIND_ICONS)[EquipmentKind] {
  return KIND_ICONS[LOOKS.get(role)?.kind ?? "house"];
}

export function accentOf(role: string): string {
  return flowColour(roleFlow(role));
}

/** What a reading means at a point; zero is idle, none is nothing. */
export function stateOf(role: string, watts: number | undefined): NodeState | undefined {
  if (watts === undefined) return undefined;

  if (watts === 0) return "idle";

  const [up, down] = LOOKS.get(role)?.states ?? ["consuming", "feeding"];

  return watts > 0 ? up : down;
}
