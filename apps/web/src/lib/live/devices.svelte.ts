/**
 * The plant's devices, and which one the dashboard is looking at.
 *
 * A switch is two things that must happen together: the inverter store has to
 * be re-pointed (its manifest, its last sample, its sparkline buffers) and the
 * plant readings have to be forgotten. Doing only the first leaves every tile
 * showing the previous machine's numbers, timestamped now and therefore not even
 * marked stale — the plausible wrong number `ownership.ts` exists to prevent. So
 * neither is exposed on its own: {@link DeviceStore.select} is the only way in.
 *
 * It lives here rather than on the inverter store because the two stores it
 * coordinates already point at each other — `plant.svelte.ts` reads the
 * manifest through `inverter` — and a third module is the way to add the arrow
 * back without a cycle.
 */

import { browser } from "$app/environment";
import { inverter } from "$lib/inverter/store.svelte";
import { api } from "$lib/api";
import { livePlant } from "./plant.svelte";

/** One device, as `/api/devices` describes it. */
interface DeviceOption {
  id: string;
  label: string;
  deviceClass: string;
  enabled: boolean;
  isDefault: boolean;
}

class DeviceStore {
  /** Every device the plant polls; empty until the list has loaded. */
  devices = $state<DeviceOption[]>([]);
  #loaded = false;

  /**
   * The device being shown. Falls back to the plant's default, which is what
   * the server answers with when a request names none.
   */
  get selectedId(): string | null {
    return inverter.deviceId;
  }

  /** The selected device's row, when the list has loaded and names it. */
  get selected(): DeviceOption | null {
    const id = this.selectedId;
    if (id === null) return this.devices.find((d) => d.isDefault) ?? null;
    return this.devices.find((d) => d.id === id) ?? null;
  }

  /**
   * Whether a switcher is worth showing at all. One device is every install
   * today, and a picker with one entry is furniture.
   */
  get hasChoice(): boolean {
    return this.devices.length > 1;
  }

  /** Load the list once. Safe to call from every mount. */
  async load(): Promise<void> {
    if (!browser || this.#loaded) return;
    this.#loaded = true;
    const { data } = await api.api.devices.get();
    if (data) this.devices = data as DeviceOption[];
  }

  /**
   * Show another device.
   *
   * The readings are cleared *before* the store is re-pointed, so there is no
   * window in which a tile can read the old machine's value against the new
   * one's manifest. Selecting the device already selected does nothing, so a
   * component re-asserting its state costs no refetch.
   */
  async select(deviceId: string | null): Promise<void> {
    if (deviceId === this.selectedId) return;
    livePlant.clearReadings();
    await inverter.switchTo(deviceId);
  }
}

export const devices = new DeviceStore();
