// The picker's list (ADR 22), from the series catalog: devices in order, each one's series grouped
// by role namespace, and what a search leaves of them. Pure: the picker renders, this decides.
import { PLANT, registered, SPOT, TARIFF, WEATHER } from "../api/computed-devices.ts";
import type { CatalogDevice } from "../api/core.ts";
import { m } from "../paraglide/messages.js";
import { describe, EXTRA, namespaceOrder, namespaceTitle } from "./labels.ts";
import { same, type SeriesRef } from "./view.ts";

type CatalogSeries = CatalogDevice["series"][number];

export interface PickerSeries {
  readonly ref: SeriesRef;
  readonly label: string;
  /** Its symbol; null without one. */
  readonly unit: string | null;
  /** Null for an extra stored before kinds. */
  readonly kind: CatalogSeries["kind"] | null;
  /** An estimate (ADR 17): written with "≈". */
  readonly estimated: boolean;
  /** The first and last stored instant, RFC 3339. */
  readonly first: string;
  readonly last: string;
}

export interface PickerGroup {
  /** The role namespace. */
  readonly id: string;
  readonly title: string;
  /** Extras stay folded until opened or searched. */
  readonly collapsed: boolean;
  readonly series: readonly PickerSeries[];
}

export interface PickerDevice {
  readonly id: number;
  readonly name: string;
  readonly removed: boolean;
  readonly groups: readonly PickerGroup[];
}

/** A computed device has no name of its own (ADR 15); the SPA names it. */
const COMPUTED = new Map<number, () => string>([
  [PLANT, m.plant_title],
  [TARIFF, m.settings_tariff],
  [SPOT, m.dash_spot],
  [WEATHER, m.dash_weather],
]);

/** The picker's order after the registered devices. */
const LAST = [TARIFF, SPOT, WEATHER];

/** A device's name: its registry name, a computed device's, else its id. */
function nameOf(id: number, name: string | null | undefined): string {
  return COMPUTED.get(id)?.() ?? name ?? m.explore_device({ id });
}

/** The plant, the registered devices, then the computed ones and the weather. */
function rank(id: number): number {
  if (id === PLANT) return 0;

  return registered(id) ? 1 : 2 + LAST.indexOf(id);
}

const byOrder = (a: readonly number[], b: readonly number[]): number =>
  a.map((n, i) => n - b[i]!).find((d) => d !== 0) ?? 0;

/** A dimensionless series (ADR 4) is written without a unit. */
const unitOf = (unit: string | null | undefined): string | null =>
  unit === undefined || unit === null || unit === "none" ? null : unit;

function groupsOf(device: CatalogDevice, estimated: ReadonlySet<string>): PickerGroup[] {
  const groups = new Map<string, { order: readonly number[]; row: PickerSeries }[]>();

  for (const stored of device.series) {
    const { namespace, label, order } = describe(stored.series);

    const row: PickerSeries = {
      ref: { device: device.id, series: stored.series },
      label,
      unit: unitOf(stored.unit),
      kind: stored.kind ?? null,
      estimated: estimated.has(stored.series),
      first: stored.first,
      last: stored.last,
    };

    groups.set(namespace, [...(groups.get(namespace) ?? []), { order, row }]);
  }

  return [...groups]
    .toSorted(([a], [b]) => namespaceOrder(a) - namespaceOrder(b) || a.localeCompare(b))
    .map(([id, rows]) => ({
      id,
      title: namespaceTitle(id),
      collapsed: id === EXTRA,
      series: rows
        .toSorted((a, b) => byOrder(a.order, b.order) || a.row.label.localeCompare(b.row.label))
        .map(({ row }) => row),
    }));
}

/**
 * The picker's devices and series.
 * @param estimated per device id, the series that are estimates, from the capabilities
 */
export function pickerOf(
  catalog: readonly CatalogDevice[],
  estimated: Readonly<Record<string, readonly string[] | undefined>>,
): PickerDevice[] {
  return catalog
    .map((device) => ({
      id: device.id,
      name: nameOf(device.id, device.name),
      removed: device.removed,
      groups: groupsOf(device, new Set(estimated[device.id])),
    }))
    .toSorted((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

/** What a search leaves: series whose label or series id holds `query`, with Extras opened. */
export function searched(devices: readonly PickerDevice[], query: string): readonly PickerDevice[] {
  const needle = query.trim().toLowerCase();

  if (needle === "") return devices;

  const hit = (s: PickerSeries) =>
    s.label.toLowerCase().includes(needle) || s.ref.series.toLowerCase().includes(needle);

  return devices.flatMap((device) => {
    const groups = device.groups.flatMap((group) => {
      const series = group.series.filter(hit);

      return series.length > 0 ? [{ ...group, collapsed: false, series }] : [];
    });

    return groups.length > 0 ? [{ ...device, groups }] : [];
  });
}

export interface Chip {
  /** "PV · Leistung"; an extra's declared name. */
  readonly label: string;
  readonly device: string;
  readonly estimated: boolean;
  readonly removed: boolean;
  readonly unit: string | null;
}

/** A chosen series as its chip; it is named before the catalog is read, and without it. */
export function chipOf(ref: SeriesRef, devices: readonly PickerDevice[]): Chip {
  const { namespace, label } = describe(ref.series);
  const device = devices.find((d) => d.id === ref.device);

  const row = device?.groups
    .flatMap((g) => g.series)
    .find((s) => same(s.ref, ref));

  return {
    label: namespace === EXTRA ? label : `${namespaceTitle(namespace)} · ${label}`,
    device: device?.name ?? nameOf(ref.device, null),
    estimated: row?.estimated ?? false,
    removed: device?.removed ?? false,
    unit: row?.unit ?? null,
  };
}
