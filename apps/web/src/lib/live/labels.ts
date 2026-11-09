// What the live scene shows (ADR 20): each string's power at its modules' centre, tinted by its
// share of its own peak, and the plant's flows on labels. Pure: no three.js.
import type { PvString, Values } from "../api/core.ts";
import type { CarPlace, Equipment, Face, Geometry, Mount, Point } from "../builder/pv.ts";
import type { Panel } from "../builder/scene.ts";
import { parked, type Parked } from "../cars/parked.ts";

/** The `plant` computed device's fixed id (ADR 15). */
export const PLANT = "4294967294";

/** Metres between the house and the label beside it. */
const BESIDE = 2;

/** What the live scene is built from. */
export interface Live3d {
  /** The layout's strings; a panel names its string by position here. */
  readonly strings: readonly Readonly<PvString>[];
  /** Watts at standard test conditions, by module type id. */
  readonly peaks: Readonly<Record<number, number>>;
  readonly panels: readonly Panel[];
  readonly faces: readonly Face[];
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

export interface StringLabel {
  readonly name: string;
  readonly watts: number | null;
  /** Of its own peak, 0 to 1; null without a value. */
  readonly share: number | null;
  /** Split from its MPPT input's power, not measured (ADR 17). */
  readonly estimated: boolean;
  /** Its modules' centre; null while it has none placed. */
  readonly centre: Point | null;
}

/**
 * One line of a label. Signs follow ADR 4: grid positive importing, battery charging. A stale
 * power is past its gap threshold (ADR 3), shown at its last value.
 */
export type Quantity =
  | { readonly kind: "grid" | "house"; readonly watts: number; readonly stale: boolean }
  | {
      readonly kind: "battery";
      readonly watts: number;
      readonly soc: number | null;
      readonly stale: boolean;
    }
  | {
      readonly kind: "inverter";
      readonly device: number;
      readonly watts: number;
      readonly stale: boolean;
    }
  | {
      readonly kind: "car";
      readonly device: number;
      readonly watts: number | null;
      readonly soc: number | null;
    };

export interface Label {
  readonly anchor: Point;
  /** The marker its leader line runs down to; null beside the house. */
  readonly leader: Point | null;
  readonly quantities: readonly Quantity[];
}

export interface LiveScene {
  readonly strings: readonly StringLabel[];
  /** By panel, its string's share; null for an unassigned module or one without a value. */
  readonly shares: readonly (number | null)[];
  readonly labels: readonly Label[];
  /** The connected cars at their places. */
  readonly cars: readonly Parked[];
}

export function liveScene(input: Live3d): LiveScene {
  const strings = input.strings.map((string, at) => stringLabel(input, string, at));
  const cars = parked(input.places ?? [], input.stands, input.values);

  return {
    strings,
    shares: input.panels.map(({ string }) =>
      string === null || string === undefined ? null : (strings[string]?.share ?? null),
    ),
    labels: [...labels(input), ...cars.map((car) => carLabel(car))],
    cars,
  };
}

function stringLabel(input: Live3d, string: Readonly<PvString>, at: number): StringLabel {
  const series = `pv.string.power[${string.id}]`;
  const watts = input.values[String(string.device)]?.[series] ?? null;
  const peak = string.modules * (input.peaks[string.moduleType] ?? 0);
  const corners = input.panels.filter((panel) => panel.string === at).flatMap((p) => p.corners);

  return {
    name: string.name,
    watts,
    share: watts === null || peak <= 0 ? null : Math.min(Math.max(watts / peak, 0), 1),
    estimated: input.estimated[String(string.device)]?.includes(series) ?? false,
    centre: corners.length === 0 ? null : mean(corners),
  };
}

function labels(input: Live3d): Label[] {
  const placed = input.mounts === null || input.mounts === undefined ? [] : input.equipment;

  const marked = (kind: Equipment["kind"], device: number): boolean =>
    placed.some((marker) => marker.kind === kind && marker.device === device);

  const plant = input.values[PLANT] ?? {};

  const isStale = (device: string, series: string): boolean =>
    input.stale?.[device]?.[series] !== undefined;

  const inverters = [...new Set(input.strings.map((string) => string.device))]
    .filter((device) => !marked("inverter", device))
    .flatMap((device) => inverter(input, device));

  const batteryMarked = placed.some((marker) => marker.kind === "battery");

  const beside: Label = {
    anchor: besideHouse(input.faces),
    leader: null,
    quantities: [
      ...flow("grid", plant["grid.power"], isStale(PLANT, "grid.power")),
      ...flow("house", plant["load.power"], isStale(PLANT, "load.power")),
      ...(batteryMarked ? [] : battery(plant, isStale(PLANT, "battery.power"))),
      ...inverters,
    ],
  };

  const onMarkers = placed.flatMap((marker, i): Label[] => {
    const mount = input.mounts?.[i];
    const values = input.values[String(marker.device)] ?? {};

    return mount === undefined
      ? []
      : [
          {
            anchor: mount.above,
            leader: mount.at,
            quantities:
              marker.kind === "inverter"
                ? inverter(input, marker.device)
                : battery(values, isStale(String(marker.device), "battery.power")),
          },
        ];
  });

  return [beside, ...onMarkers];
}

/** A connected car's charge power and SOC, above it. */
function carLabel({ device, at, above, watts, soc }: Parked): Label {
  return { anchor: above, leader: at, quantities: [{ kind: "car", device, watts, soc }] };
}

function flow(kind: "grid" | "house", watts: number | undefined, stale: boolean): Quantity[] {
  return watts === undefined ? [] : [{ kind, watts, stale }];
}

function battery(values: Readonly<Record<string, number>>, stale: boolean): Quantity[] {
  const watts = values["battery.power"];

  return watts === undefined
    ? []
    : [{ kind: "battery", watts, soc: values["battery.soc"] ?? null, stale }];
}

function inverter(input: Live3d, device: number): Quantity[] {
  const watts = input.values[String(device)]?.["pv.power"];
  const stale = input.stale?.[String(device)]?.["pv.power"] !== undefined;

  return watts === undefined ? [] : [{ kind: "inverter", device, watts, stale }];
}

function mean(points: readonly Point[]): Point {
  const sum = (axis: 0 | 1 | 2): number =>
    points.reduce((total, point) => total + point[axis], 0) / points.length;

  return [sum(0), sum(1), sum(2)];
}

/** East of the house's eastmost point, level with its middle and its top. */
function besideHouse(faces: readonly Face[]): Point {
  const corners = faces.flatMap((face) => face.corners);

  if (corners.length === 0) return [0, 0, 0];

  const along = (axis: 0 | 1 | 2) => corners.map((corner) => corner[axis]);
  const north = along(1);

  return [
    Math.max(...along(0)) + BESIDE,
    (Math.min(...north) + Math.max(...north)) / 2,
    Math.max(...along(2)),
  ];
}
