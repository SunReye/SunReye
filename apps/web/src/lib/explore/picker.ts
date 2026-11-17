// The picker's list (ADR 22), from the series catalog: devices in order, each one's series grouped
// by role namespace, and what a search leaves of them. Pure: the picker renders, this decides.
import { PLANT, registered, SPOT, TARIFF, WEATHER } from "../api/computed-devices.ts";
import type { CatalogDevice } from "../api/core.ts";
import { m } from "../paraglide/messages.js";
import { describe, EXTRA, namespaceOrder, namespaceTitle, seriesName } from "../roles.ts";
import { same, type SeriesRef } from "./view.ts";

/** A catalog device, read-only through and through. */
export type Listed = Readonly<Omit<CatalogDevice, "series">> & {
  readonly series: readonly Readonly<CatalogDevice["series"][number]>[];
};

export interface PickerSeries {
  readonly ref: SeriesRef;
  readonly label: string;
  /** Its symbol; null without one. */
  readonly unit: string | null;
  /** Null for an extra stored before kinds. */
  readonly kind: CatalogDevice["series"][number]["kind"] | null;
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

/** A series and where it stands in its group. */
interface Placed {
  readonly order: readonly number[];
  readonly row: PickerSeries;
}

function byOrder(a: Placed, b: Placed): number {
  const apart = a.order.map((n, i) => n - b.order[i]!).find((d) => d !== 0);

  return apart ?? a.row.label.localeCompare(b.row.label);
}

/** A dimensionless series (ADR 4) is written without a unit. */
const unitOf = (unit: string | null | undefined): string | null =>
  unit === undefined || unit === null || unit === "none" ? null : unit;

function placed(device: number, stored: Listed["series"][number]) {
  const { namespace, label, order } = describe(stored.series);

  const row: PickerSeries = {
    ref: { device, series: stored.series },
    label,
    unit: unitOf(stored.unit),
    kind: stored.kind ?? null,
    estimated: stored.estimated,
    first: stored.first,
    last: stored.last,
  };

  return { namespace, order, row };
}

function groupsOf(device: Listed): PickerGroup[] {
  const groups = new Map<string, Placed[]>();

  for (const stored of device.series) {
    const { namespace, ...place } = placed(device.id, stored);

    groups.set(namespace, [...(groups.get(namespace) ?? []), place]);
  }

  return [...groups.keys()]
    .toSorted((a, b) => namespaceOrder(a) - namespaceOrder(b) || a.localeCompare(b))
    .map((id) => ({
      id,
      title: namespaceTitle(id),
      collapsed: id === EXTRA,
      series: (groups.get(id) ?? []).toSorted(byOrder).map(({ row }: Placed) => row),
    }));
}

/** The picker's devices and series. */
export function pickerOf(catalog: readonly Listed[]): PickerDevice[] {
  return catalog
    .map((device: Listed) => ({
      id: device.id,
      name: nameOf(device.id, device.name),
      removed: device.removed,
      groups: groupsOf(device),
    }))
    .toSorted(
      (a: PickerDevice, b: PickerDevice) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name),
    );
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

/** A chosen series: what its chip says, and what its chart needs of the catalog. */
export interface Chosen {
  readonly ref: SeriesRef;
  /** "PV · Leistung"; an extra's declared name. */
  readonly label: string;
  readonly device: string;
  readonly estimated: boolean;
  readonly removed: boolean;
  /** These four are null until the catalog lists the series. */
  readonly unit: string | null;
  readonly kind: PickerSeries["kind"];
  readonly first: string | null;
  readonly last: string | null;
}

/** What the catalog knows of a series, and what stands in before it lists it. */
function listed(row: PickerSeries | undefined) {
  if (row === undefined)
    return { estimated: false, unit: null, kind: null, first: null, last: null };

  return {
    estimated: row.estimated,
    unit: row.unit,
    kind: row.kind,
    first: row.first,
    last: row.last,
  };
}

/** A chosen series; it is named before the catalog is read, and without it. */
export function chosenOf(ref: SeriesRef, devices: readonly PickerDevice[]): Chosen {
  const device = devices.find((d) => d.id === ref.device);
  const row = device?.groups.flatMap((g) => g.series).find((s) => same(s.ref, ref));

  return {
    ref,
    label: seriesName(ref.series),
    device: device?.name ?? nameOf(ref.device, null),
    removed: device?.removed ?? false,
    ...listed(row),
  };
}
