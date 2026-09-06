/**
 * The plant's SOURCES — what a dashboard may read a series from — and the
 * member set behind the `plant` source.
 *
 * Read per request from the plant repository (three small selects) rather than
 * cached off the device registry: the registry drops retired devices, and the
 * plant's HISTORY must not (`plantMembers` in `../shared/plant-source.ts`).
 *
 * Session-gated, unlike the admin roster in `./device-admin.ts`: a viewer
 * choosing which device a chart shows is a dashboard read. The view carries
 * nothing an ordinary user may not see — no connection, no unit id, no profile.
 */

import type { DeviceBatteryRecord, DeviceRecord, PlantRecord } from "@SunReye/db/plant-repo";
import { isRetired, physicalDevices } from "@SunReye/db/plant-repo";
import { type MemberRow, type PlantMember, plantMembers } from "../shared/plant-source";

export interface PlantSourcesStore {
  readPlant(): Promise<PlantRecord | null>;
  readDevices(plantId: number): Promise<DeviceRecord[]>;
  readPlantBatteries(plantId: number): Promise<DeviceBatteryRecord[]>;
}

/** One selectable device, as the dashboard sees it. */
export interface SourceView {
  slug: string;
  name: string;
  role: string;
  retired: boolean;
  /** Whether the plant series is read from this device. */
  member: boolean;
}

export interface SourcesResponse {
  /** The `plant` source's members, by slug — empty when nothing can be summed. */
  plant: { members: string[] };
  /** Physical devices in roster order; the virtual optimizer is not a source. */
  devices: SourceView[];
}

async function memberRows(store: PlantSourcesStore): Promise<MemberRow[]> {
  const plant = await store.readPlant();
  if (!plant) return [];
  const [devices, batteries] = await Promise.all([
    store.readDevices(plant.id),
    store.readPlantBatteries(plant.id),
  ]);
  const kwh = new Map(batteries.map((b) => [b.deviceId, b.usableKwh]));
  return devices.map((d) => ({
    id: d.id,
    slug: d.slug,
    name: d.name,
    role: d.role,
    retiredAt: d.retiredAt,
    batteryKwh: kwh.get(d.id) ?? null,
  }));
}

/** The member set for a history read (retired included) or a live one. */
export async function readPlantMembers(
  store: PlantSourcesStore,
  opts: { live?: boolean } = {},
): Promise<PlantMember[]> {
  return plantMembers(await memberRows(store), opts);
}

export async function listSources(store: PlantSourcesStore): Promise<SourcesResponse> {
  const rows = await memberRows(store);
  const members = new Set(plantMembers(rows).map((m) => m.id));
  return {
    plant: { members: rows.filter((r) => members.has(r.id)).map((r) => r.slug) },
    devices: physicalDevices(rows).map((r) => ({
      slug: r.slug,
      name: r.name,
      role: r.role,
      retired: isRetired(r),
      member: members.has(r.id),
    })),
  };
}
