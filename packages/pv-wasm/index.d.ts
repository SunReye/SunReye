// The `pv` crate's browser build, crates/pv-wasm, and its answers' types (ADRs 17, 20, 25). It
// reads and returns the scene as `@sunreye/scene` types it.

import type {
  Chimney,
  InverterType,
  Opening,
  OpeningKind,
  RoofWindow,
  Scene,
  Wiring,
} from "@sunreye/scene";
import type { Face, Geometry, Point, Unfit } from "./geometry.d.ts";
import type { FillRules, Ghost, Modules, OnGrid, Sizes } from "./layout.d.ts";

export type * from "./geometry.d.ts";

export type * from "./layout.d.ts";

/** North and east positive, in degrees. */
export interface Location {
  readonly latitude: number;
  readonly longitude: number;
}

/** In degrees; the azimuth 0 = south, −90 = east, 90 = west (ADR 17). */
export interface Sun {
  readonly zenith: number;
  readonly azimuth: number;
}

/** A module type's datasheet values the crate reads, as the core's API names them. */
export interface ModuleType {
  readonly id: number;
  /** Volts and amperes at the maximum power point. */
  readonly vmp: number;
  readonly imp: number;
  /** Open-circuit volts and short-circuit amperes. */
  readonly voc: number;
  readonly isc: number;
  /** Of Voc and Isc, in %/K. */
  readonly voltageCoefficient: number;
  readonly currentCoefficient: number;
  /** Metres. */
  readonly width: number;
  readonly height: number;
  readonly bypassDiodes: number;
}

/**
 * An upright body around the plant that its consumer supplies: a footprint on the ground under a
 * level top. It shades as the scene's obstacles do (ADR 20).
 */
export interface Neighbour {
  /** Its outline's corners, metres east and north of the scene's origin: north up, whatever the
   * scene's compass. */
  readonly footprint: readonly (readonly [number, number])[];
  /** Its top's height above the ground, in metres. */
  readonly height: number;
}

/** A layout under a clear sky: the scene names its strings by position in `strings`. */
export interface ClearRun {
  readonly location: Location;
  readonly scene: Scene;
  /** The consumer's neighbours, shading as the scene's obstacles do. */
  readonly neighbours?: readonly Neighbour[];
  readonly moduleTypes: readonly ModuleType[];
  readonly strings: readonly Wiring[];
  /** Seconds since 1970, UTC. */
  readonly times: readonly number[];
}

/**
 * Weather at a fixed step, as columns: sample `i` is at `start + i × step` and its power is held
 * for one step. Irradiance in W/m², air temperature in °C, wind in m/s.
 */
export interface WeatherSteps {
  /** Seconds since 1970, UTC. */
  readonly start: number;
  /** Seconds; 900 for quarter hours. */
  readonly step: number;
  readonly ghi: readonly number[];
  readonly dni: readonly number[];
  readonly dhi: readonly number[];
  readonly temperature: readonly number[];
  /** Null where unknown; absent where the source has none. */
  readonly wind?: readonly (number | null)[];
}

/** A layout over a year of weather (ADR 17): the scene names its strings by position. */
export interface YearRun {
  readonly location: Location;
  readonly scene: Scene;
  /** The consumer's neighbours, shading as the scene's obstacles do. */
  readonly neighbours?: readonly Neighbour[];
  readonly moduleTypes: readonly ModuleType[];
  readonly strings: readonly Wiring[];
  /** By inverter device id: its inputs' limits and AC side. An inverter without one caps no input and has no AC side. */
  readonly inverterTypes?: Readonly<Record<number, InverterType>>;
  readonly weather: WeatherSteps;
}

/** Twenty or more whole UTC years at one step over a rounded location (ADR 17). A value that
 * averages the step before its time is stamped at the step's middle; `start` is the first such
 * stamp. Hourly years give a typical year at quarter hours. */
export interface PastYears {
  readonly location: Location;
  readonly years: readonly WeatherSteps[];
}

/** A rounded location's typical year, stamped in 2001, and the past year each month, January first,
 * comes from. Made from hourly years it comes at quarter hours: each hour's mean split along the
 * clear sky's shape, its energy kept; otherwise at the years' step. */
export interface TypicalYear {
  readonly weather: WeatherSteps;
  readonly sources: readonly number[];
}

/** A layout over a year of weather, for its irradiation on its planes. */
export type Irradiated = Omit<YearRun, "inverterTypes">;

/** A past year's irradiation on a layout's planes, in Wh/m². */
export interface PastIrradiation {
  readonly year: number;
  readonly irradiation: number;
}

/** The simulated typical year's energy, its irradiation in Wh/m² and each past year's. */
export interface Scaling {
  readonly simulated: number;
  readonly typical: number;
  readonly years: readonly PastIrradiation[];
}

/** P50 and P90 in the simulated energy's unit, and how they were made: P50 is the simulated typical
 * year itself; P90, exceeded in nine years of ten, is P50 × (1 − 1.2816 σ), σ the sample deviation
 * of each past year's irradiation over the typical year's. */
export interface Cautious {
  readonly p50: number;
  readonly p90: number;
  readonly basis: {
    readonly method: "irradiationScaling";
    readonly typical: number;
    readonly years: readonly PastIrradiation[];
    /** The mean and the sample deviation of the ratios; P50 does not read the mean. */
    readonly mean: number;
    readonly deviation: number;
  };
}

/** Watt-hours by UTC month, January first, and over the whole run. */
export interface Energy {
  readonly months: readonly number[];
  readonly total: number;
}

/** A year's run: each string's energy by position, each inverter's with its MPPT inputs. */
export interface YearEnergy {
  /** Zero for a string of an unknown module type. */
  readonly strings: readonly Energy[];
  readonly inverters: readonly {
    readonly device: number;
    /** The sum of its inputs, on the DC side. */
    readonly dc: Energy;
    /** After its type's efficiency curve, capped at its AC rating, and what the cap cut; absent without a type. */
    readonly ac?: { readonly energy: Energy; readonly clipped: Energy };
    /** By input number, from 1. */
    readonly inputs: readonly { readonly input: number; readonly energy: Energy }[];
  }[];
}

/** One MPPT input's limits, as the core's capabilities list them (ADR 9). */
export interface InputLimits {
  /** Amperes. */
  readonly maxCurrent: number;
  /** Volts: its window, and where it starts. */
  readonly minVoltage: number;
  readonly maxVoltage: number;
  readonly startVoltage: number;
}

/** Each inverter's inputs' limits in the inputs' order, by device id. */
export type Inverters = Readonly<Record<number, readonly InputLimits[]>>;

/** Where a layout leaves an MPPT input's limits; a string by its position in the layout. */
export type Sizing =
  | {
      /** Never starts in the cold, held under the window when hot, clipped over it in the cold. */
      readonly kind: "start" | "low" | "high";
      readonly string: number;
      readonly volts: number;
      readonly limit: number;
    }
  | {
      readonly kind: "current";
      readonly device: number;
      readonly input: number;
      readonly amperes: number;
      readonly limit: number;
    }
  | { readonly kind: "uneven"; readonly device: number; readonly input: number }
  | { readonly kind: "noInput"; readonly string: number };

/** The engine. Each call throws the crate's reason for an input it cannot read. */
export interface Pv {
  /** The scene's faces and solids. */
  readonly geometry: (scene: Scene) => Geometry;
  /** The scene's module grids laid out, with module sizes by module type id. */
  readonly modules: (scene: Scene, sizes: Sizes) => Modules;
  /** Where the sun stands at `unix` seconds over `location`. */
  readonly sun: (unix: number, location: Location) => Sun;
  /** The neighbours' walls and tops, east, north, up; throws the crate's reason for one refused. */
  readonly neighbours: (neighbours: readonly Neighbour[]) => Face[];
  /** Each string's watts under a clear sky, by time, then string position (ADR 20). */
  readonly clearSky: (run: ClearRun) => number[][];
  /** The energy of every string, MPPT input and inverter over a year of weather (ADR 17). */
  readonly year: (run: YearRun) => YearEnergy;
  /** `location` to 0.01°: what a typical year belongs to, and the key to cache one by. */
  readonly roundedLocation: (location: Location) => Location;
  /** A rounded location's typical year from twenty or more past years (ADR 17). */
  readonly typicalYear: (past: PastYears) => TypicalYear;
  /** A layout's irradiation on its planes in Wh/m², without shade or electrics (ADR 17). */
  readonly irradiation: (run: Irradiated) => number;
  /** P50 and P90 of a simulated typical year (ADR 17). */
  readonly cautious: (scaling: Scaling) => Cautious;
  /** Each string's open-circuit voltage at −10 °C, by position; null for an unknown module type. */
  readonly coldVoltages: (
    moduleTypes: readonly ModuleType[],
    strings: readonly Wiring[],
  ) => (number | null)[];
  /** The layout's MPPT window warnings: each string's own, then each input's. */
  readonly sizing: (
    moduleTypes: readonly ModuleType[],
    strings: readonly Wiring[],
    inverters: Inverters,
  ) => Sizing[];
  /** The most modules of `moduleType` in series that stay under the inverter's maximum DC input
   * voltage and the input's window at −10 °C; null without either limit. */
  readonly longest: (
    moduleType: ModuleType,
    maxInputVoltage: number | null,
    limits: InputLimits | null,
  ) => number | null;
  /** Opening `index` as `opening`, kept on its wall and under its eave, or why it cannot be. */
  readonly refit: (
    scene: Scene,
    index: number,
    opening: Opening,
  ) => { readonly opening: Opening } | { readonly unfit: Unfit };
  /** A new opening of `kind` and its usual size in the first free place on a wall: a wall at a
   * time from the front, each from its left end; null when none takes it. */
  readonly place: (
    scene: Scene,
    kind: OpeningKind,
    usual: Readonly<Required<Pick<Opening, "width" | "height" | "sill">>>,
  ) => Opening | null;
  /** Chimney `index` moved by a level east and north, in metres, along its face: in 10 cm steps,
   * stopped at the face's edge and sliding along it; null without it or its face. */
  readonly glide: (scene: Scene, index: number, shift: readonly [number, number]) => Chimney | null;
  /** The index of the chimney a strike at `point` lands on; null for none. */
  readonly chimneyAt: (scene: Scene, point: Point) => number | null;
  /** The index of the grid whose face a strike at `point` lands on, inside its setback. */
  readonly gridAt: (scene: Scene, point: Point) => number | null;
  /** What a press on a grid's face at `from`, dragged to `to`, would lay: the ghost module under
   * the pointer, snapped, and with a drag the row along it; null for a press off the face. */
  readonly lay: (on: OnGrid, from: Point, to: Point) => Ghost[] | null;
  /** Module `module` of a grid dragged from `from` to `to`: where it would lie, snapped like a
   * ghost, and whether it fits there; null without it. */
  readonly slide: (on: OnGrid, module: number, from: Point, to: Point) => Ghost | null;
  /** The places "Fill face" adds to a grid under `rules`, the builder's own without: across and
   * up its face. */
  readonly fillFace: (on: OnGrid, rules?: FillRules) => (readonly [number, number])[];
  /** The modules a roof chimney or roof window covers: each its grid's index and its own in it. */
  readonly covered: (scene: Scene, sizes: Sizes) => (readonly [number, number])[];
  /** Roof window `index` moved like a chimney, stopped at a chimney or another roof window too. */
  readonly glideWindow: (
    scene: Scene,
    index: number,
    shift: readonly [number, number],
  ) => RoofWindow | null;
  /** The index of the roof window a strike at `point` lands on; null for none. */
  readonly roofWindowAt: (scene: Scene, point: Point) => number | null;
  /** A new roof window, `size` across and up, in the free place nearest the middle of the first
   * roof face with room, off its modules; null where none has. */
  readonly placeWindow: (
    scene: Scene,
    sizes: Sizes,
    size: readonly [number, number],
  ) => RoofWindow | null;
}

/** Instantiates the engine from the bytes of `@sunreye/pv-wasm/pv.wasm`. */
export declare function loadPv(bytes: Uint8Array<ArrayBuffer>): Promise<Pv>;
