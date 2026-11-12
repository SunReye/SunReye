// Settings' groups on the drill-in (ADR 21), in order; the display is each browser's own, the rest the admin's.
import Cable from "@lucide/svelte/icons/cable";
import CloudSun from "@lucide/svelte/icons/cloud-sun";
import Cpu from "@lucide/svelte/icons/cpu";
import MapPin from "@lucide/svelte/icons/map-pin";
import Monitor from "@lucide/svelte/icons/monitor";
import PenLine from "@lucide/svelte/icons/pen-line";
import Receipt from "@lucide/svelte/icons/receipt";
import ScrollText from "@lucide/svelte/icons/scroll-text";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { m } from "../paraglide/messages.js";

export const DISPLAY = "display";

const ICONS = {
  plant: MapPin,
  devices: Cpu,
  // Controls' read-only banner links here by this id.
  writes: PenLine,
  connections: Cable,
  tariff: Receipt,
  forecast: CloudSun,
  [DISPLAY]: Monitor,
  logs: ScrollText,
  danger: TriangleAlert,
} as const;

type GroupId = keyof typeof ICONS;

const LABELS: Readonly<Record<GroupId, () => string>> = {
  plant: m.settings_plant,
  devices: m.settings_devices,
  writes: m.settings_writes,
  connections: m.settings_connections,
  tariff: m.settings_tariff,
  forecast: m.settings_forecast,
  [DISPLAY]: m.settings_display,
  logs: m.settings_logs,
  danger: m.settings_danger,
};

const ORDER: readonly GroupId[] = [
  "plant",
  "devices",
  "writes",
  "connections",
  "tariff",
  "forecast",
  DISPLAY,
  "logs",
  "danger",
];

/** The drill-in's rows this caller may open; `summary` gives a group's values in a few words. */
export function settingsGroups(admin: boolean, summary: (id: string) => string | undefined) {
  return ORDER.flatMap((id) => {
    if (!admin && id !== DISPLAY) return [];

    const said = summary(id);
    const row = { id, label: LABELS[id](), icon: ICONS[id] };

    return [said === undefined ? row : { id, label: row.label, icon: row.icon, summary: said }];
  });
}
