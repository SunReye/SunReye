// Settings' groups on the drill-in (ADR 21), in order; the display is each browser's own, the rest the admin's.
import { m } from "../paraglide/messages.js";
import { DISPLAY, ICONS } from "./group-icons.ts";

export { DISPLAY } from "./group-icons.ts";

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
