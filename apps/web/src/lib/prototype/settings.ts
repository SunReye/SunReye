import BatteryCharging from "@lucide/svelte/icons/battery-charging";
import UtilityPole from "@lucide/svelte/icons/utility-pole";
import Clock from "@lucide/svelte/icons/clock";
import Cpu from "@lucide/svelte/icons/cpu";
import type { Component } from "svelte";

export type Setting =
  | { id: string; kind: "number"; label: string; value: number; min: number; max: number; step: number; unit: string }
  | { id: string; kind: "time"; label: string; value: number; step: number }
  | { id: string; kind: "enum"; label: string; value: string; options: { value: string; hint: string }[] }
  | { id: string; kind: "info"; label: string; value: string };

export interface Group {
  id: string;
  label: string;
  icon: Component<{ class?: string }>;
  tint: string;
  settings: Setting[];
}

export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function display(s: Setting): string {
  if (s.kind === "number") return `${new Intl.NumberFormat("de-DE").format(s.value)} ${s.unit}`;
  if (s.kind === "time") return hhmm(s.value);
  return s.value;
}

export function initialGroups(): Group[] {
  return [
    {
      id: "battery",
      label: "Batterie",
      icon: BatteryCharging,
      tint: "var(--e-battery)",
      settings: [
        { id: "chargeA", kind: "number", label: "Max. Ladestrom", value: 100, min: 0, max: 240, step: 1, unit: "A" },
        { id: "dischargeA", kind: "number", label: "Max. Entladestrom", value: 120, min: 0, max: 240, step: 1, unit: "A" },
        { id: "minSoc", kind: "number", label: "Min. SOC", value: 20, min: 5, max: 100, step: 5, unit: "%" },
        { id: "maxSoc", kind: "number", label: "Ladeschluss-SOC", value: 100, min: 50, max: 100, step: 5, unit: "%" },
      ],
    },
    {
      id: "grid",
      label: "Netz & Einspeisung",
      icon: UtilityPole,
      tint: "var(--e-export)",
      settings: [
        { id: "exportW", kind: "number", label: "Max. Einspeiseleistung", value: 7000, min: 0, max: 12000, step: 100, unit: "W" },
        { id: "gridCharge", kind: "enum", label: "Netzladen", value: "Aus", options: [{ value: "Aus", hint: "Batterie lädt nur aus PV" }, { value: "Bei Niedrigpreis", hint: "Unter 10 ct/kWh" }, { value: "An", hint: "Immer erlaubt" }] },
      ],
    },
    {
      id: "mode",
      label: "Arbeitsmodus & Zeitplan",
      icon: Clock,
      tint: "var(--e-solar)",
      settings: [
        {
          id: "workMode",
          kind: "enum",
          label: "Arbeitsmodus",
          value: "Eigenverbrauch",
          options: [
            { value: "Eigenverbrauch", hint: "PV zuerst ins Haus, dann Batterie" },
            { value: "Einspeisung zuerst", hint: "Überschuss ins Netz vor der Batterie" },
            { value: "Nulleinspeisung", hint: "Kein Export, Leistung wird begrenzt" },
            { value: "Notstrom-Reserve", hint: "Batterie hält die Reserve" },
          ],
        },
        { id: "slot1Start", kind: "time", label: "Zeitfenster 1 · Beginn", value: 22 * 60, step: 5 },
        { id: "slot1End", kind: "time", label: "Zeitfenster 1 · Ende", value: 6 * 60, step: 5 },
        { id: "slot1Soc", kind: "number", label: "Zeitfenster 1 · Ziel-SOC", value: 80, min: 5, max: 100, step: 5, unit: "%" },
      ],
    },
    {
      id: "system",
      label: "System",
      icon: Cpu,
      tint: "var(--e-house)",
      settings: [
        { id: "fw", kind: "info", label: "Firmware", value: "MAIN 1.53 · HMI 1.16" },
        { id: "serial", kind: "info", label: "Seriennummer", value: "2306…4471" },
        { id: "clock", kind: "info", label: "Uhrzeit", value: "synchron" },
      ],
    },
  ];
}

export function summary(g: Group): string {
  const by = (id: string) => g.settings.find((s) => s.id === id);
  const d = (id: string) => {
    const s = by(id);
    return s ? display(s) : "";
  };
  if (g.id === "battery") return `${d("chargeA")} · Min. ${d("minSoc")}`;
  if (g.id === "grid") return `${d("exportW")} · Netzladen ${d("gridCharge").toLowerCase()}`;
  if (g.id === "mode") return `${d("workMode")} · ${d("slot1Start")}–${d("slot1End")}`;
  return "Firmware 1.53 · synchron";
}
