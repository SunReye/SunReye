import type { Pathname } from "$app/types";
import * as m from "$lib/paraglide/messages";

/**
 * Every settings panel, once.
 *
 * This table used to live inside `settings-nav.svelte`, which meant the nav rail
 * was the only thing that knew a panel existed. The shell header therefore had
 * nothing to read and `settings/+layout.svelte` set a single static "Settings"
 * for all fourteen panels — the header said the same word on /settings/mqtt,
 * /settings/users and /settings/danger. Lifting the table out gives the header
 * the same source the rail renders, so a new panel gets its title by existing
 * rather than by someone remembering a second call site.
 *
 * Titles and subtitles are message KEYS, not thunks: a key can be checked
 * against the catalogue (`nav-routes.test.ts`), and a thunk hiding an English
 * literal cannot be told from a real translation until a German build ships.
 * The icons deliberately stay in the nav component — they are `.svelte`
 * imports, and this module has to stay loadable by `bun test`.
 */
export type MessageKey = keyof typeof m & string;

/** Rail sections, in render order. */
export type SettingsGroup = "connection" | "preferences" | "admin";

export type SettingsRoute = {
  /** Directory name under `routes/(app)/settings/`, and the table's key. */
  id: string;
  href: Pathname;
  group: SettingsGroup;
  titleKey: MessageKey;
  subtitleKey: MessageKey;
};

export const SETTINGS_ROUTES: readonly SettingsRoute[] = [
  {
    id: "inverter",
    href: "/settings/inverter",
    group: "connection",
    titleKey: "label_inverter",
    subtitleKey: "settings_sub_inverter",
  },
  {
    id: "devices",
    href: "/settings/devices",
    group: "connection",
    titleKey: "settings_tab_devices",
    subtitleKey: "settings_sub_devices",
  },
  {
    id: "sensors",
    href: "/settings/sensors",
    group: "connection",
    titleKey: "settings_tab_sensors",
    subtitleKey: "settings_sub_sensors",
  },
  {
    id: "mqtt",
    href: "/settings/mqtt",
    group: "connection",
    titleKey: "settings_tab_mqtt",
    subtitleKey: "settings_sub_mqtt",
  },
  {
    id: "display",
    href: "/settings/display",
    group: "preferences",
    titleKey: "settings_tab_display",
    subtitleKey: "settings_sub_display",
  },
  {
    id: "tariff",
    href: "/settings/tariff",
    group: "preferences",
    titleKey: "settings_tab_tariff",
    subtitleKey: "settings_sub_tariff",
  },
  {
    id: "prices",
    href: "/settings/prices",
    group: "preferences",
    titleKey: "settings_tab_prices",
    subtitleKey: "settings_sub_prices",
  },
  {
    id: "weather",
    href: "/settings/weather",
    group: "preferences",
    titleKey: "settings_tab_weather",
    subtitleKey: "settings_sub_weather",
  },
  {
    id: "access",
    href: "/settings/access",
    group: "admin",
    titleKey: "settings_tab_access",
    subtitleKey: "settings_sub_access",
  },
  {
    id: "automations",
    href: "/settings/automations",
    group: "admin",
    titleKey: "settings_tab_automations",
    subtitleKey: "settings_sub_automations",
  },
  {
    id: "profiles",
    href: "/settings/profiles",
    group: "admin",
    titleKey: "settings_tab_profiles",
    subtitleKey: "settings_sub_profiles",
  },
  {
    id: "users",
    href: "/settings/users",
    group: "admin",
    titleKey: "settings_tab_users",
    subtitleKey: "settings_sub_users",
  },
  {
    id: "api-keys",
    href: "/settings/api-keys",
    group: "admin",
    titleKey: "settings_tab_apikeys",
    subtitleKey: "settings_sub_apikeys",
  },
  {
    id: "logs",
    href: "/settings/logs",
    group: "admin",
    titleKey: "settings_tab_logs",
    subtitleKey: "settings_sub_logs",
  },
  {
    id: "danger",
    href: "/settings/danger",
    group: "admin",
    titleKey: "settings_tab_danger",
    subtitleKey: "settings_sub_danger",
  },
];

/** Paraglide compiles one exported function per message; index it by key. */
const bundle = m as unknown as Record<string, () => string>;

/** The message a key names, resolved in the viewer's current locale. */
export function message(key: MessageKey): string {
  return bundle[key]!();
}

export type SettingsHeader = { title: () => string; subtitle: () => string };

/**
 * The shell header for a settings path, or null when the path is not a panel.
 *
 * Null on `/settings` itself matters: that route only redirects to the first
 * panel, and guessing a header for it would flash the wrong title on the way
 * past. A path deeper than a panel (a future `/settings/users/42`) still
 * belongs to that panel — the header should not blank out mid-drilldown.
 */
export function settingsHeaderFor(path: string): SettingsHeader | null {
  const route = SETTINGS_ROUTES.find((r) => path === r.href || path.startsWith(`${r.href}/`));
  if (!route) return null;
  return { title: () => message(route.titleKey), subtitle: () => message(route.subtitleKey) };
}
