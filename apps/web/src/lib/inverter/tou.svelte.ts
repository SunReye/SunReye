import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import { coreCapabilities } from "$lib/capabilities.svelte";
import { postSetting } from "$lib/engine-only";
import { inverter } from "$lib/inverter/store.svelte";
import * as m from "$lib/paraglide/messages";
import type { ManifestMetric } from "$lib/inverter/types";

/**
 * The Deye/Sunsynk time-of-use schedule is six consecutive daily periods. The
 * profile ships them as flat metrics keyed `timeofuse.<field>.<index>` (plus a
 * standalone `timeofuse.selling`) with no per-slot metadata, so this controller
 * reconstructs the slots and owns the write path shared by every TOU view.
 */
export type TouField = "enabled" | "time" | "power" | "voltage" | "soc";

export interface TouSlot {
  /** 1-based slot number as programmed on the inverter (order it cycles in). */
  index: number;
  metrics: Partial<Record<TouField, ManifestMetric>>;
}

const MINUTES_PER_DAY = 24 * 60;

/** Deye encodes a start time as the decimal HHMM (e.g. 1730 → 17:30). */
export function hhmmToMinutes(v: number): number {
  const hh = Math.floor(v / 100);
  const mm = v % 100;
  return (hh * 60 + mm) % MINUTES_PER_DAY;
}

/** HHMM register value → "HH:MM" for a native <input type="time"> / labels. */
export function hhmmToLabel(v: number | undefined): string {
  if (v === undefined) return "--:--";
  const hh = Math.floor(v / 100);
  const mm = v % 100;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** "HH:MM" → HHMM register value, or null if unparseable. */
export function labelToHhmm(s: string): number | null {
  const [hh, mm] = s.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 100 + mm;
}

/** Minutes-since-midnight → "HH:MM". */
export function minutesToLabel(min: number): string {
  const m = ((min % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export class TouController {
  // Optimistic overrides, mirroring control-row: a local value wins over the
  // streamed one the moment the user commits, until the next live sample lands.
  #pending = new SvelteMap<string, number>();
  #busy = new SvelteSet<string>();

  get metrics(): ManifestMetric[] {
    return inverter.inGroup("timeofuse");
  }

  /** The weekly selling-schedule register (146), if the profile exposes it. */
  get selling(): ManifestMetric | undefined {
    return this.metrics.find((m) => m.key === "timeofuse.selling");
  }

  /**
   * Which per-slot target the inverter actually honors, from the read-only
   * battery-mode register: lead-acid batteries are driven by target voltage,
   * lithium (BMS) by target SOC. Editing both never makes sense, so views show
   * only the active one. Profiles without the register — or before its first
   * sample lands — fall back to `"both"` (the prior always-show behavior).
   */
  get targetMode(): "voltage" | "soc" | "both" {
    const m = inverter.byRole("battery.mode");
    if (!m) return "both";
    const v = inverter.value(m.key);
    if (v === undefined) return "both";
    return v === 1 ? "soc" : "voltage";
  }

  /** The six schedule slots, grouped by index and ordered 1→6. */
  get slots(): TouSlot[] {
    const byIndex = new Map<number, TouSlot>();
    for (const m of this.metrics) {
      const [, field, rawIndex] = m.key.split("."); // timeofuse.<field>.<i>
      const index = Number(rawIndex);
      if (!Number.isInteger(index)) continue;
      const slot = byIndex.get(index) ?? { index, metrics: {} };
      slot.metrics[field as TouField] = m;
      byIndex.set(index, slot);
    }
    return [...byIndex.values()].sort((a, b) => a.index - b.index);
  }

  /** Displayed value for a key: the pending write wins over the live sample. */
  value(key: string): number | undefined {
    return this.#pending.get(key) ?? inverter.value(key);
  }

  busy(key: string): boolean {
    return this.#busy.has(key);
  }

  async write(key: string, value: number, label: string): Promise<void> {
    // Monitoring only (ADR 0005): a core that serves no controls takes no schedule edit.
    if (!coreCapabilities.has("controls")) return;
    this.#busy.add(key);
    this.#pending.set(key, value);
    try {
      if (!(await postSetting(key, value))) throw new Error("setting refused");
      toast.success(`${label} → ${value}`);
    } catch {
      toast.error(m.tou_toast_update_failed({ label }));
      this.#pending.delete(key);
    } finally {
      this.#busy.delete(key);
    }
  }
}
