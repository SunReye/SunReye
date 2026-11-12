// The first run's steps in order (ADR 11, 21): each a drill-in level, only the next one open.
import CircleCheck from "@lucide/svelte/icons/circle-check";
import Cpu from "@lucide/svelte/icons/cpu";
import KeyRound from "@lucide/svelte/icons/key-round";
import MapPin from "@lucide/svelte/icons/map-pin";
import Network from "@lucide/svelte/icons/network";
import SolarPanel from "@lucide/svelte/icons/solar-panel";
import type { DrillGroup } from "../components/drill-in/drill-in.svelte";
import { m } from "../paraglide/messages.js";

export type Step = "password" | "plant" | "devices" | "topology" | "layout";

const TITLES: Readonly<Record<Step, () => string>> = {
  password: m.password_set,
  plant: m.plant_title,
  devices: m.devices_title,
  topology: m.topology_title,
  layout: m.layout_title,
};

const ICONS = {
  password: KeyRound,
  plant: MapPin,
  devices: Cpu,
  topology: Network,
  layout: SolarPanel,
};

/** The steps to run: under Home Assistant's ingress the admin is signed in and sets no password. */
export function steps(signedIn: boolean): readonly Step[] {
  const all: readonly Step[] = ["password", "plant", "devices", "topology", "layout"];

  return signedIn ? all.slice(1) : all;
}

export function title(step: Step): string {
  return TITLES[step]();
}

/** The drill-in's rows: done, next or later; only the next one opens. */
export function stepGroups(list: readonly Step[], next: number): DrillGroup[] {
  return list.map((id, at) => ({
    id,
    label: title(id),
    summary: at < next ? m.setup_done() : at === next ? m.setup_next_up() : m.setup_later(),
    icon: at < next ? CircleCheck : ICONS[id],
    disabled: at !== next,
  }));
}

export function isStep(id: string | null): id is Step {
  return id !== null && id in TITLES;
}
