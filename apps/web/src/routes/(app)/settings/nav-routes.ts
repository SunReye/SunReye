import type { Pathname } from "$app/types";
import type { CapabilityName } from "$lib/capabilities";
import * as m from "$lib/paraglide/messages";

/**
 * Every settings panel, once.
 *
 * This table used to live inside `settings-nav.svelte`, which meant the nav rail
 * was the only thing that knew a panel existed. The shell header therefore had
 * nothing to read and `settings/+layout.svelte` set a single static "Settings"
 * for all fourteen panels — the header said the same word on /settings/plant,
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
  /**
   * Kept out of the rail. A route that only redirects (the old `/settings/inverter`
   * bookmark) still needs a header while it lands, and still has to be in this
   * table for the census — but a link to it would be a link to somewhere else.
   */
  hidden?: true;
  /**
   * The core area this panel edits. A core that reports the area absent has nothing to
   * serve it, so the rail drops the panel and its URL lands on a panel that is offered.
   */
  capability?: CapabilityName;
};

// fallow-ignore-next-line unused-export -- the table itself, read directly by nav-routes.test.ts and settings-nav.svelte.test.ts; the app reads it through railRoutes and settingsHeaderFor
export const SETTINGS_ROUTES: readonly SettingsRoute[] = [
  {
    id: "devices",
    href: "/settings/devices",
    group: "connection",
    titleKey: "settings_tab_devices",
    subtitleKey: "settings_sub_devices",
  },
  // The pre-2.0 inverter panel: connection + plant facts on one page. Both moved
  // — the connection into Devices (a gateway is one of several), the facts into
  // Plant — and the path redirects so bookmarks and the setup wizard's link land.
  {
    id: "inverter",
    href: "/settings/inverter",
    group: "connection",
    titleKey: "settings_tab_devices",
    subtitleKey: "settings_sub_inverter",
    hidden: true,
  },
  // Integrations are ROWS on the Devices panel — a connection is the thing that
  // fails, so "what is on this endpoint" stays grouped by connection. What lives
  // here is one integration's own page (`/settings/integrations/:id`), reached
  // by clicking its row: its live status, its settings, and the devices it
  // provides. It is a drilldown, not a panel, so it is kept OUT of the rail for
  // the same reason `/settings/inverter` is — a rail link would have nowhere to
  // point, since no single integration is "the" one. `/settings/integrations`
  // itself only redirects back to the list it came from.
  {
    id: "integrations",
    href: "/settings/integrations",
    group: "connection",
    titleKey: "settings_tab_integrations",
    subtitleKey: "settings_sub_integrations",
    hidden: true,
    capability: "integrations",
  },
  {
    id: "plant",
    href: "/settings/plant",
    group: "connection",
    titleKey: "settings_tab_plant",
    subtitleKey: "settings_sub_plant",
  },
  {
    id: "sensors",
    href: "/settings/sensors",
    group: "connection",
    titleKey: "settings_tab_sensors",
    subtitleKey: "settings_sub_sensors",
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
    capability: "pricesAndCosts",
  },
  {
    id: "prices",
    href: "/settings/prices",
    group: "preferences",
    titleKey: "settings_tab_prices",
    subtitleKey: "settings_sub_prices",
    capability: "pricesAndCosts",
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
    capability: "logging",
  },
  {
    id: "danger",
    href: "/settings/danger",
    group: "admin",
    titleKey: "settings_tab_danger",
    subtitleKey: "settings_sub_danger",
    capability: "dataReset",
  },
];

/** Paraglide compiles one exported function per message; index it by key. */
const bundle = m as unknown as Record<string, () => string>;

/** The message a key names, resolved in the viewer's current locale. */
export function message(key: MessageKey): string {
  return bundle[key]!();
}

/** Whether the connected core serves an area; `coreCapabilities.has` in the app. */
export type Offers = (area: CapabilityName) => boolean;

/** The panel a path belongs to: the panel itself, or anything below it. */
function routeFor(path: string): SettingsRoute | undefined {
  return SETTINGS_ROUTES.find((r) => path === r.href || path.startsWith(`${r.href}/`));
}

/**
 * The panels the rail links, in render order: not hidden, the core serves what they edit,
 * and admin panels only for an admin.
 */
export function railRoutes(isAdmin: boolean, offers: Offers): SettingsRoute[] {
  return SETTINGS_ROUTES.filter(
    (r) => !r.hidden && (isAdmin || r.group !== "admin") && (!r.capability || offers(r.capability)),
  );
}

/** Whether `path` is a panel (or a page under one) whose core area the core does not serve. */
export function gatedAway(path: string, offers: Offers): boolean {
  const capability = routeFor(path)?.capability;
  return capability !== undefined && !offers(capability);
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
  const route = routeFor(path);
  if (!route) return null;
  return {
    title: () => message(route.titleKey),
    subtitle: () => message(route.subtitleKey),
  };
}
