// What the live scene shows (ADR 20): each string tinted by its share of its own peak, and a chip
// per string, inverter, battery, car and plant flow. Pure: no three.js.
import { PLANT, type PvString, type Values } from "../api/core.ts";
import type { CarPlace, Equipment } from "@sunreye/scene";
import type { Geometry, Mount, Point } from "@sunreye/pv-wasm";
import type { Panel } from "@sunreye/builder";
import { parked, type Parked } from "@sunreye/builder/canvas";
import { formatFigure } from "../detail/figures.ts";
import type { EquipmentKind } from "../equipment-kinds.ts";

/** What the live scene is built from. */
export interface Live3d {
  /** The layout's strings; a panel names its string by position here. */
  readonly strings: readonly Readonly<PvString>[];
  /** Watts at standard test conditions, by module type id. */
  readonly peaks: Readonly<Record<number, number>>;
  readonly panels: readonly Panel[];
  readonly equipment: readonly Equipment[];
  /** By `equipment`; none while a marker lies off its wall. */
  readonly mounts: readonly Mount[] | null | undefined;
  /** By device id, its estimated series (ADR 17). */
  readonly estimated: Readonly<Record<string, readonly string[] | undefined>>;
  readonly values: Values["devices"];
  /** When each stale value was last read; none while none is. */
  readonly stale?: Values["stale"];
  readonly places?: readonly CarPlace[];
  /** By `places`; none while one is refused. */
  readonly stands?: Geometry["stands"];
}

/** What a chip shows; signs follow ADR 4 (grid positive importing, battery charging). */
export type ChipKind = Extract<
  EquipmentKind,
  "string" | "inverter" | "battery" | "grid" | "house" | "ev"
>;

/** One label chip (ADR 20). */
export interface Chip {
  /** Unique within the scene. */
  readonly key: string;
  /** The detail sheet it opens (lib/detail/figures.ts). */
  readonly id: string;
  readonly kind: ChipKind;
  /** A string's name; null for equipment. */
  readonly name: string | null;
  readonly watts: number | null;
  readonly soc: number | null;
  /** Split from its MPPT input's power, not measured (ADR 17). */
  readonly estimated: boolean;
  /** Past its gap threshold (ADR 3), shown at its last value. */
  readonly stale: boolean;
  /** The modules, marker or car its leader line runs to; null for a chip that stands for none. */
  readonly leader: Point | null;
}

export interface LiveScene {
  readonly chips: readonly Chip[];
  /** By panel, its string's share; null for an unassigned module or one without a value. */
  readonly shares: readonly (number | null)[];
  /** The connected cars at their places. */
  readonly cars: readonly Parked[];
}

interface Reading {
  readonly watts: number | null;
  readonly soc?: number | null;
  readonly estimated?: boolean;
  readonly stale?: boolean;
}

function chip(
  key: string,
  id: string,
  kind: ChipKind,
  reading: Reading,
  leader: Point | null,
  name: string | null = null,
): Chip {
  const { watts, soc = null, estimated = false, stale = false } = reading;

  return { key, id, kind, name, watts, soc, estimated, stale, leader };
}

export function liveScene(input: Live3d): LiveScene {
  const shares = input.strings.map((string) => share(input, string));
  const cars = parked(input.places ?? [], input.stands, input.values);

  return {
    chips: [
      ...input.strings.flatMap((string, at) => stringChip(input, string, at)),
      ...equipment(input),
      ...cars.map(({ device, at, watts, soc }) => {
        const id = formatFigure({ kind: "ev", id: device });

        return chip(id, id, "ev", { watts, soc }, at);
      }),
    ],
    shares: input.panels.map(({ string }) =>
      string === null || string === undefined ? null : (shares[string] ?? null),
    ),
    cars,
  };
}

const stringSeries = (string: Readonly<PvString>): string => `pv.string.power[${string.id}]`;

/** Of its own peak, 0 to 1; null without a value. */
function share(input: Live3d, string: Readonly<PvString>): number | null {
  const watts = input.values[String(string.device)]?.[stringSeries(string)];
  const peak = string.modules * (input.peaks[string.moduleType] ?? 0);

  return watts === undefined || peak <= 0 ? null : Math.min(Math.max(watts / peak, 0), 1);
}

/** At its modules' centre; none while it has no module placed. */
function stringChip(input: Live3d, string: Readonly<PvString>, at: number): Chip[] {
  const device = String(string.device);
  const series = stringSeries(string);
  const corners = input.panels.filter((panel) => panel.string === at).flatMap((p) => p.corners);

  if (corners.length === 0) return [];

  const centre = mean(corners);
  const id = formatFigure({ kind: "string", id: string.id });

  const reading = {
    watts: input.values[device]?.[series] ?? null,
    estimated: input.estimated[device]?.includes(series) ?? false,
    stale: input.stale?.[device]?.[series] !== undefined,
  };

  return [chip(id, id, "string", reading, centre, string.name)];
}

/** A device's power series and whether it is stale; null without a value. */
function seriesReading(input: Live3d, device: number | string, series: string): Reading | null {
  const watts = input.values[device]?.[series];

  return watts === undefined
    ? null
    : { watts, stale: input.stale?.[device]?.[series] !== undefined };
}

function batteryReading(input: Live3d, device: number | string): Reading | null {
  const power = seriesReading(input, device, "battery.power");

  return power === null ? null : { ...power, soc: input.values[device]?.["battery.soc"] ?? null };
}

/** An inverter's AC power, as its sheet reads it; its PV power while it publishes none. */
const inverterReading = (input: Live3d, device: string): Reading | null =>
  seriesReading(input, device, "inverter.power") ?? seriesReading(input, device, "pv.power");

/** A chip that stands for no marker; none without a reading. */
const at = (key: string, id: string, kind: ChipKind, read: Reading | null): Chip[] =>
  read === null ? [] : [chip(key, id, kind, read, null)];

function equipment(input: Live3d): Chip[] {
  const placed = input.mounts === null || input.mounts === undefined ? [] : input.equipment;

  const marked = (kind: Equipment["kind"], device: number): boolean =>
    placed.some((marker) => marker.kind === kind && marker.device === device);

  const inverters = [...new Set(input.strings.map((string) => string.device))]
    .filter((device) => !marked("inverter", device))
    .flatMap((device) =>
      at(`inverter-${device}`, "inverter", "inverter", inverterReading(input, String(device))),
    );

  const onMarkers = placed.flatMap((marker, i): Chip[] => {
    const mount = input.mounts?.[i];
    const device = String(marker.device);

    const read =
      marker.kind === "inverter" ? inverterReading(input, device) : batteryReading(input, device);

    return mount === undefined || read === null
      ? []
      : [chip(`${marker.kind}-${device}`, marker.kind, marker.kind, read, mount.at)];
  });

  return [
    ...at("grid", "grid", "grid", seriesReading(input, PLANT, "grid.power")),
    ...at("house", "house", "house", seriesReading(input, PLANT, "load.power")),
    ...(placed.some((marker) => marker.kind === "battery")
      ? []
      : at("battery", "battery", "battery", batteryReading(input, PLANT))),
    ...inverters,
    ...onMarkers,
  ];
}

function mean(points: readonly Point[]): Point {
  const sum = (axis: 0 | 1 | 2): number =>
    points.reduce((total, point) => total + point[axis], 0) / points.length;

  return [sum(0), sum(1), sum(2)];
}
