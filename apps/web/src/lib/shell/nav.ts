// The shell's destinations (ADR 21). Devices has no screen yet; it joins the rail with one.
import Activity from "@lucide/svelte/icons/activity";
import ChartLine from "@lucide/svelte/icons/chart-line";
import CloudSun from "@lucide/svelte/icons/cloud-sun";
import House from "@lucide/svelte/icons/house";
import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
import Receipt from "@lucide/svelte/icons/receipt";
import Settings from "@lucide/svelte/icons/settings";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import type { Component } from "svelte";
import { m } from "../paraglide/messages.js";

export interface NavItem {
  /** The route id, as `page.route.id` reports it. */
  readonly route: string;
  readonly label: () => string;
  readonly icon: Component<{ class?: string }>;
  /** Shown to the admin only. */
  readonly admin?: true;
}

export const DASHBOARD: NavItem = { route: "/", label: m.nav_dashboard, icon: LayoutDashboard };

/** The rail's upper list, in order; Controls is the admin's. */
export const RAIL: readonly NavItem[] = [
  DASHBOARD,
  { route: "/history", label: m.nav_history, icon: ChartLine },
  { route: "/forecast", label: m.nav_forecast, icon: CloudSun },
  { route: "/tariff", label: m.nav_tariff, icon: Receipt },
  { route: "/controls", label: m.nav_controls, icon: SlidersHorizontal, admin: true },
  { route: "/builder", label: m.nav_builder, icon: House },
  { route: "/status", label: m.nav_status, icon: Activity },
];

/** Pinned to the rail's foot. */
export const SETTINGS: NavItem = { route: "/settings", label: m.nav_settings, icon: Settings };

/** The hash link to a route. */
export function href(route: string): string {
  return `#${route}`;
}
