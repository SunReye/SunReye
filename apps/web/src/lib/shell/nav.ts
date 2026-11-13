// The shell's destinations (ADR 21). Devices has no screen of its own; it opens Settings › Devices.
import Activity from "@lucide/svelte/icons/activity";
import ChartLine from "@lucide/svelte/icons/chart-line";
import House from "@lucide/svelte/icons/house";
import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
import Settings from "@lucide/svelte/icons/settings";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import type { Component } from "svelte";
import { m } from "../paraglide/messages.js";
// Forecast, Tariff and Devices share their settings groups' icons.
import { ICONS } from "../settings/group-icons.ts";

export interface NavItem {
  /** The route id, as `page.route.id` reports it. */
  readonly route: string;
  readonly label: () => string;
  readonly icon: Component<{ class?: string }>;
  /** Shown to the admin only. */
  readonly admin?: true;
}

export const DASHBOARD: NavItem = { route: "/", label: m.nav_dashboard, icon: LayoutDashboard };

/** The phone bar's four screens; More holds the rest. */
export const BAR: readonly NavItem[] = [
  DASHBOARD,
  { route: "/history", label: m.nav_history, icon: ChartLine },
  { route: "/forecast", label: m.nav_forecast, icon: ICONS.forecast },
  { route: "/tariff", label: m.nav_tariff, icon: ICONS.tariff },
];

const CONTROLS: NavItem = {
  route: "/controls",
  label: m.nav_controls,
  icon: SlidersHorizontal,
  admin: true,
};

const BUILDER: NavItem = { route: "/builder", label: m.nav_builder, icon: House };

const DEVICES: NavItem = {
  route: "/settings?group=devices",
  label: m.settings_devices,
  icon: ICONS.devices,
  admin: true,
};

const STATUS: NavItem = { route: "/status", label: m.nav_status, icon: Activity };

/** The rail's upper list, in order; Controls is the admin's. */
export const RAIL: readonly NavItem[] = [...BAR, CONTROLS, BUILDER, STATUS];

/** Pinned to the rail's foot. */
export const SETTINGS: NavItem = { route: "/settings", label: m.nav_settings, icon: Settings };

/** The phone's More sheet, in order; Controls is the admin's. */
export const MORE: readonly NavItem[] = [CONTROLS, SETTINGS, DEVICES, BUILDER, STATUS];

/** The hash link to a route. */
export function href(route: string): string {
  return `#${route}`;
}
