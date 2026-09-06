/**
 * WHERE the dashboard reads from: the plant, or one device by slug (#202).
 *
 * The pure half of `./source.svelte.ts`: the vocabulary, the query fragment
 * every read appends, the persisted choice, and the rule for which metrics a
 * plant view can show. Plain TS so it runs under `bun test`.
 */

import { plantAggregateOf } from "@SunReye/inverter-core/plant-aggregate";

/** `plant`, or a `devices.slug`. */
export type SourceId = string;
export const PLANT: SourceId = "plant";

/** `GET /api/sources` — what may be read from. */
export interface SourcesResponse {
  plant: { members: string[] };
  devices: Array<{
    slug: string;
    name: string;
    /** The id a live `metrics` frame carries for this device — the profile id, today. */
    profileId?: string;
    role: string;
    retired: boolean;
    member: boolean;
  }>;
}

export const STORAGE_KEY = "sunreye.source";

/** The query fragment every series read carries. */
export function sourceQuery(current: SourceId): { source: SourceId } {
  return { source: current };
}

/** The devices a viewer can pick: in service. A retired device's history is still in the plant's. */
const selectable = (sources: SourcesResponse | null) =>
  sources?.devices.filter((d) => !d.retired) ?? [];

/**
 * Whether the switcher has anything to switch: more than one device in
 * service. A single-device plant reads the same under either name, so it shows
 * none.
 */
export function offersChoice(sources: SourcesResponse | null): boolean {
  return selectable(sources).length > 1;
}

/**
 * The choice to honour on load: the saved one if it still names a source, else
 * the plant. A device retired or renamed since the last visit falls back rather
 * than pinning the page to a name nothing answers.
 */
export function resolveSaved(saved: string | null, sources: SourcesResponse | null): SourceId {
  if (saved && saved !== PLANT && selectable(sources).some((d) => d.slug === saved)) return saved;
  return PLANT;
}

/**
 * Whether a metric is shown under `current`. A plant of several devices has no
 * value for a per-device role — a voltage, a phase, a status word — so those
 * leave the catalog while the plant is selected. One device, or one member,
 * shows everything as before.
 */
export function shownUnder(
  current: SourceId,
  sources: SourcesResponse | null,
  metric: { role?: string | undefined },
): boolean {
  if (current !== PLANT || (sources?.plant.members.length ?? 0) <= 1) return true;
  return plantAggregateOf(metric.role) !== "per-device";
}

/** The switcher's options: the plant first, then every device in roster order. */
export function sourceOptions(
  sources: SourcesResponse,
  plantLabel: string,
): Array<{ id: SourceId; label: string }> {
  return [
    { id: PLANT, label: plantLabel },
    ...selectable(sources).map((d) => ({ id: d.slug, label: d.name })),
  ];
}

/**
 * Whether a live `metrics` frame belongs to the selected source. The plant's
 * own frames arrive on the `plant` topic; a device frame counts for its own
 * slug — or for the profile id the driver stamps it with today, looked up
 * through the source list. Undefined `inverterId` never matches.
 */
export function acceptsMetricsFrame(
  current: SourceId,
  inverterId: string | undefined,
  sources: SourcesResponse | null = null,
): boolean {
  if (current === PLANT || inverterId === undefined) return false;
  if (inverterId === current) return true;
  const device = sources?.devices.find((d) => d.slug === current);
  return device?.profileId !== undefined && device.profileId === inverterId;
}
