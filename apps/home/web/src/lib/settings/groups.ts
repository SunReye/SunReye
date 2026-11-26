// Settings' groups on the drill-in (ADR 21), in order; the display and About are everyone's, the rest the admin's.
import Info from "@lucide/svelte/icons/info";
import { m } from "../paraglide/messages.js";
import { DISPLAY, ICONS as THEIRS } from "./group-icons.ts";

export { DISPLAY } from "./group-icons.ts";

const ABOUT = "about";

const ICONS = { ...THEIRS, [ABOUT]: Info } as const;

type GroupId = keyof typeof ICONS;

const LABELS: Readonly<Record<GroupId, () => string>> = {
  plant: m.settings_plant,
  devices: m.settings_devices,
  writes: m.settings_writes,
  connections: m.settings_connections,
  tariff: m.settings_tariff,
  forecast: m.settings_forecast,
  access: m.settings_access,
  [DISPLAY]: m.settings_display,
  [ABOUT]: m.settings_about,
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
  "access",
  DISPLAY,
  ABOUT,
  "logs",
  "danger",
];

/** The drill-in's rows this caller may open; `summary` gives a group's values in a few words. */
export function settingsGroups(admin: boolean, summary: (id: string) => string | undefined) {
  return ORDER.flatMap((id) => {
    if (!admin && id !== DISPLAY && id !== ABOUT) return [];

    const said = summary(id);
    const row = { id, label: LABELS[id](), icon: ICONS[id] };

    return [said === undefined ? row : { id, label: row.label, icon: row.icon, summary: said }];
  });
}
