// The `pv` crate's browser build, crates/pv-wasm, and its answers' types (ADRs 17, 20, 25). It
// reads and returns the scene as `@sunreye/scene` types it.

import type { Chimney, Opening, OpeningKind, RoofWindow, Scene, Wiring } from "@sunreye/scene";
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

/** A string as auto-stringing reads and makes it. */
export type Strand = Readonly<Pick<Wiring, "moduleType" | "device" | "input" | "modules">>;

/** What auto-stringing reads (ADR 20): the scene, its module types, the inverter the new strings
 * go to by device, each of its limits where known, and the layout's strings so far, which the new
 * ones follow. */
export interface Stringing {
  readonly scene: Scene;
  readonly moduleTypes: readonly ModuleType[];
  readonly device: number;
  readonly inverter: {
    /** Volts. */
    readonly maxInputVoltage: number | null;
    /** In the inputs' order; null where the inverter lists none. */
    readonly inputs: readonly InputLimits[] | null;
  };
  readonly taken: readonly Strand[];
}

/** A proposal: the scene with modules wired into the new strings, and how many stay in none. */
export interface Strung {
  readonly scene: Scene;
  readonly strings: Strand[];
  readonly left: number;
}

/** Where a layout leaves an MPPT input's limits; a string by its position in the layout. */
export type Sizing =
  | {
      /** Never starts in the cold, held under the window when hot, clipped over it in the cold;
       * open-circuit over the inverter's maximum in the cold. */
      readonly kind: "start" | "low" | "high" | "open";
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
  /** Grid `grid`'s modules in no string as new strings, in a serpentine cut as few as the
   * inverter's limits allow; `refused` where it has no free input, null where the grid holds no
   * module in no string. */
  readonly autoStringFace: (
    stringing: Stringing,
    grid: number,
  ) => Strung | { readonly refused: "input" } | null;
  /** Every face strung so, the one with the most modules in no string first, each on the inputs
   * the faces before left free. */
  readonly autoString: (stringing: Stringing) => Strung;
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
