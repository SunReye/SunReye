import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
import ChartLine from "@lucide/svelte/icons/chart-line";
import CloudSun from "@lucide/svelte/icons/cloud-sun";
import ReceiptEuro from "@lucide/svelte/icons/receipt-euro";
import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
import Settings from "@lucide/svelte/icons/settings";
import Router from "@lucide/svelte/icons/router";
import House from "@lucide/svelte/icons/house";
import Activity from "@lucide/svelte/icons/activity";
import type { Component } from "svelte";

export type Screen =
  | "dashboard"
  | "history"
  | "forecast"
  | "tariff"
  | "controls"
  | "settings"
  | "devices"
  | "builder"
  | "status";

export interface NavItem {
  id: Screen;
  label: string;
  icon: Component<{ class?: string }>;
}

export const NAV: Record<Screen, NavItem> = {
  dashboard: { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  history: { id: "history", label: "Verlauf", icon: ChartLine },
  forecast: { id: "forecast", label: "Prognose", icon: CloudSun },
  tariff: { id: "tariff", label: "Tarif", icon: ReceiptEuro },
  controls: { id: "controls", label: "Steuerung", icon: SlidersHorizontal },
  settings: { id: "settings", label: "Einstellungen", icon: Settings },
  devices: { id: "devices", label: "Geräte", icon: Router },
  builder: { id: "builder", label: "Builder", icon: House },
  status: { id: "status", label: "Status", icon: Activity },
};

/** Rail order; Controls is admin-only and has its own entry. */
export const RAIL: Screen[] = ["dashboard", "history", "forecast", "tariff", "controls", "devices", "builder", "status"];
export const BAR: Screen[] = ["dashboard", "history", "forecast", "tariff"];
export const MORE: Screen[] = ["controls", "settings", "devices", "builder", "status"];
