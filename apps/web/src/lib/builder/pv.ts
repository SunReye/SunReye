// The `pv` crate in the browser through its glue crate, crates/pv-wasm (ADR 2, 20).
import type { ModuleType, StringDraft } from "../api/core.ts";
import type { Fence, Fencing, Ground, GroundSurface, Obstacle } from "./obstacles.ts";
import { surrounding, type Import, type Surrounding } from "./imported.ts";
import type { Chimney, Overhang } from "./roofing.ts";
import type { Equipment, Fitted, Opening, OpeningKind, Unfit } from "./walls.ts";

export type { Equipment, Fitted, Opening, OpeningKind, Unfit, Wall, WallFrame } from "./walls.ts";

import {
  isChimney,
  isExports,
  isGeometry,
  isGhost,
  isIndex,
  isList,
  isModules,
  isOpening,
  isRefit,
  isSun,
  isVolts,
  isWatts,
  unwrap,
  type Exported,
} from "./replies.ts";

export type {
  Fence,
  FenceFinish,
  FencePoint,
  Fencing,
  Ground,
  GroundFinish,
  GroundSurface,
  Obstacle,
} from "./obstacles.ts";

export type { Chimney, Footing, Overhang } from "./roofing.ts";

import type { ModuleGrid, OnGrid, Sizes } from "./grids.ts";
import type { Ghost, Modules } from "./laid.ts";

export type { GridModule, ModuleGrid, OnGrid, Sizes, Spot } from "./grids.ts";

export type { Footprint, Ghost, LaidGrid, Misplaced, Modules, RoofFace } from "./laid.ts";

/** A string as the core's API wires it. */
export type Wiring = Readonly<Omit<StringDraft, "id">>;

/** Metres: east, north, up. */
export type Point = readonly [number, number, number];

export type Roof =
  | { readonly kind: "flat" }
  | { readonly kind: "monoPitch" | "gable" | "hip"; readonly pitch: number };

/** A rectangular footprint with one roof; its width runs along x, its depth along z. */
export interface Block {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly eave: number;
  /** Degrees clockwise about the corner, seen from above. */
  readonly rotation: number;
  readonly roof: Roof;
  /** A carport: a post at each corner instead of walls. */
  readonly open?: boolean;
  /** Metres the roof reaches past the walls, level: at the eaves and at the verges. */
  readonly overhang?: Overhang;
  /** `#rrggbb`; the finish's own colour without one. */
  readonly roofColour?: string | null;
  readonly wallColour?: string | null;
}

/** A parking footprint linked to an EVCC loadpoint; width along x, length along z. */
export interface CarPlace {
  readonly device: number;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly length: number;
  readonly rotation: number;
  /** The default body's paint, `#rrggbb`, and the id of an uploaded GLB that replaces it. */
  readonly colour?: string | null;
  readonly model?: string | null;
}

/** The scene's frame: metres, y up, origin at the first block's corner (ADR 20). */
export interface Scene {
  /** The compass bearing of the scene's −z axis, in degrees. */
  readonly north: number;
  readonly blocks: readonly Block[];
  readonly obstacles: readonly Obstacle[];
  /** At most one per roof face. */
  readonly grids?: readonly ModuleGrid[];
  readonly equipment?: readonly Equipment[];
  readonly carPlaces?: readonly CarPlace[];
  readonly chimneys?: readonly Chimney[];
  /** Each drawn over the last; without any the plot is lawn. */
  readonly surfaces?: readonly GroundSurface[];
  readonly fences?: readonly Fence[];
  readonly openings?: readonly Opening[];
  /** The imported surroundings it draws and shades with; none, none. */
  readonly imported?: Import | null;
}

export interface Face {
  readonly surface: "wall" | "roof" | "obstacle" | "hedge" | "chimney";
  /** A flat convex polygon. */
  readonly corners: readonly Point[];
  /** Its block's wall or roof colour, `#rrggbb`. */
  readonly colour?: string;
}

export type Solid =
  | { readonly kind: "sphere"; readonly centre: Point; readonly radius: number }
  | {
      /** Upright; a cone narrows from `radius` at its base to its apex `height` above. */
      readonly kind: "cylinder" | "cone";
      readonly base: Point;
      readonly radius: number;
      readonly height: number;
    };

/** Where a marker is drawn, and its label's anchor straight above it, clear of its block. */
export interface Mount {
  readonly at: Point;
  readonly above: Point;
}

/** What the crate draws and shades. */
export interface Geometry {
  readonly faces: readonly Face[];
  readonly solids: readonly Solid[];
  /** By the scene's equipment; null while a marker lies off its wall. */
  readonly mounts?: readonly Mount[] | null;
  /** By car place: its centre on the ground, its nose's direction and its label; null while one
   * is refused. */
  readonly stands?:
    | readonly { readonly at: Point; readonly forward: Point; readonly above: Point }[]
    | null;
  /** By ground surface and by fence, placed on the ground; null while one is refused. */
  readonly ground?: readonly Ground[] | null;
  readonly fences?: readonly Fencing[] | null;
  /** By opening, fitted on its wall; null while one is refused. */
  readonly openings?: readonly Fitted[] | null;
}

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

/** A layout under a clear sky: the scene names its strings by position in `strings`. */
export interface ClearRun {
  readonly location: Location;
  readonly scene: Scene;
  readonly moduleTypes: readonly Readonly<ModuleType>[];
  readonly strings: readonly Wiring[];
  /** Seconds since 1970, UTC. */
  readonly times: readonly number[];
}

export interface Pv extends Surrounding {
  /** The scene's faces and solids; throws the crate's reason for a scene it cannot read. */
  readonly geometry: (scene: Scene) => Geometry;
  /** The scene's module grids laid out, with module sizes by module type id. */
  readonly modules: (scene: Scene, sizes: Sizes) => Modules;
  /** Where the sun stands at `unix` seconds over `location`. */
  readonly sun: (unix: number, location: Location) => Sun;
  /** Each string's watts under a clear sky, by time, then string position (ADR 20). */
  readonly clearSky: (run: ClearRun) => number[][];
  /** Each string's open-circuit voltage at −10 °C, by position; null for an unknown module type. */
  readonly coldVoltages: (
    moduleTypes: readonly Readonly<ModuleType>[],
    strings: readonly Wiring[],
  ) => (number | null)[];
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
  /** The places "Fill face" adds to a grid: across and up its face. */
  readonly fillFace: (on: OnGrid) => (readonly [number, number])[];
  /** The modules a roof chimney stands on: each its grid's index and its own in it. */
  readonly covered: (scene: Scene, sizes: Sizes) => (readonly [number, number])[];
}

/** The reply of a glue crate's export to its JSON input. */
type Call = (name: Exported, input: string) => string;

/** What the crate answers while modules are laid (ADR 20 Modules). */
function laying(call: Call): Pick<Pv, "gridAt" | "lay" | "slide" | "fillFace" | "covered"> {
  return {
    gridAt: (scene, point) => unwrap(call("grid_at", JSON.stringify({ scene, point })), isIndex),
    lay: (on, from, to) => unwrap(call("lay", JSON.stringify({ ...on, from, to })), isList<Ghost>),
    slide: (on, module, from, to) =>
      unwrap(call("slide", JSON.stringify({ ...on, module, from, to })), isGhost),
    fillFace: (on) =>
      unwrap(call("fill", JSON.stringify(on)), isList<readonly [number, number]>) ?? [],
    covered: (scene, sizes) =>
      unwrap(
        call("covered", JSON.stringify({ scene, sizes })),
        isList<readonly [number, number]>,
      ) ?? [],
  };
}

/** Instantiates the glue crate's release build. */
export async function loadPv(bytes: Uint8Array<ArrayBuffer>): Promise<Pv> {
  const { instance } = await WebAssembly.instantiate(bytes);
  const wasm = instance.exports;

  if (!isExports(wasm)) throw new TypeError("pv WASM lacks an export");

  /** The reply of export `name` to the JSON `input`. */
  const call: Call = (name, input) => {
    const encoded = new TextEncoder().encode(input);
    const at = wasm.reserve(encoded.length);

    new Uint8Array(wasm.memory.buffer, at, encoded.length).set(encoded);

    const packed = wasm[name](at, encoded.length);

    wasm.release(at, encoded.length);

    const [ptr, len] = [Number(packed >> 32n), Number(packed & 0xffff_ffffn)];
    const text = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, ptr, len));

    wasm.release(ptr, len);

    return text;
  };

  return {
    geometry: (scene) => unwrap(call("geometry", JSON.stringify(scene)), isGeometry),
    modules: (scene, sizes) => unwrap(call("modules", JSON.stringify({ scene, sizes })), isModules),
    sun: (unix, location) => unwrap(call("sun", JSON.stringify({ unix, location })), isSun),
    clearSky: (run) => unwrap(call("clear_sky", JSON.stringify(run)), isWatts),
    coldVoltages: (moduleTypes, strings) =>
      unwrap(call("cold_voltages", JSON.stringify({ moduleTypes, strings })), isVolts),
    refit: (scene, index, opening) =>
      unwrap(call("refit", JSON.stringify({ scene, index, opening })), isRefit),
    place: (scene, kind, usual) =>
      unwrap(call("place", JSON.stringify({ scene, kind, ...usual })), isOpening),
    glide: (scene, index, shift) =>
      unwrap(call("glide", JSON.stringify({ scene, index, shift })), isChimney),
    chimneyAt: (scene, point) =>
      unwrap(call("chimney_at", JSON.stringify({ scene, point })), isIndex),
    ...laying(call),
    ...surrounding(call),
  };
}

/** The unit vector toward the sun: east, north, up, as the pv crate shades. */
export function sunward({ zenith, azimuth }: Sun): Point {
  const [z, a] = [(zenith * Math.PI) / 180, (azimuth * Math.PI) / 180];

  return [-Math.sin(a) * Math.sin(z), -Math.cos(a) * Math.sin(z), Math.cos(z)];
}

/** Toward the sun over `location` at `at`, ms since 1970: east, north, up. */
export function sunAt(pv: Readonly<Pick<Pv, "sun">>, location: Location, at: number): Point {
  return sunward(pv.sun(Math.floor(at / 1000), location));
}
