// How Controls' groups look on the drill-in's root (ADR 21): a Paraglide label, an icon, a summary.
import BatteryCharging from "@lucide/svelte/icons/battery-charging";
import Cpu from "@lucide/svelte/icons/cpu";
import UtilityPole from "@lucide/svelte/icons/utility-pole";
import type { DrillGroup } from "../components/drill-in/drill-in.svelte";
import { m } from "../paraglide/messages.js";
import { summary, type Control, type ControlGroup } from "./groups.ts";

const LABELS = {
  battery: m.controls_group_battery,
  grid: m.controls_group_grid,
  advanced: m.controls_group_advanced,
} as const;

const ICONS = { battery: BatteryCharging, grid: UtilityPole, advanced: Cpu } as const;

/** The drill-in's rows for `groups`, each summarising the values `value` knows. */
export function drillGroups(
  groups: readonly ControlGroup[],
  value: (control: Control) => number | null,
  locale: string,
): DrillGroup[] {
  return groups.map((group) => ({
    id: group.id,
    label: LABELS[group.id](),
    summary: summary(group, value, locale),
    icon: ICONS[group.id],
  }));
}
