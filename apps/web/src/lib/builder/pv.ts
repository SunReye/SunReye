// The `pv` crate in the browser through its glue crate, crates/pv-wasm (ADR 2, 20).
import type { Chimney, Opening, OpeningKind, RoofWindow, Scene, Wiring } from "@sunreye/scene";
import type { ModuleType } from "../api/core.ts";
import type { Fencing, Ground } from "./obstacles.ts";
import { roofCalls } from "./roof-calls.ts";
import { sizingCalls, type Sizer } from "./sizing.ts";
import type { Fitted, Unfit } from "./walls.ts";

export type { Fitted, Unfit, WallFrame } from "./walls.ts";

import {
  isChimney,
  isExports,
  isGeometry,
  isIndex,
  isModules,
  isOpening,
  isRefit,
  isSun,
  isVolts,
  isWatts,
  unwrap,
  type Exported,
} from "./replies.ts";

export type { Fencing, Ground } from "./obstacles.ts";

export type { Footing } from "./roofing.ts";

import type { OnGrid, Sizes } from "./grids.ts";
import type { Ghost, Modules } from "./laid.ts";

export type { OnGrid, Sizes, Spot } from "./grids.ts";

export type { Footprint, Ghost, LaidGrid, Misplaced, Modules, RoofFace } from "./laid.ts";

// The scene's own types, as the builder and the views name them (ADR 25).
export type {
  Block,
  CarPlace,
  Chimney,
  Equipment,
  Fence,
  FenceFinish,
  FencePoint,
  GridModule,
  GroundFinish,
  GroundSurface,
  Light,
  ModuleGrid,
  Obstacle,
  Opening,
  OpeningKind,
  Overhang,
  Roof,
  RoofWindow,
  Scene,
  Wall,
  Wiring,
} from "@sunreye/scene";

/** Metres: east, north, up. */
export type Point = readonly [number, number, number];

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
  /** A metre out of its wall, level: the way it faces. */
  readonly out: Point;
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
  /** By roof window, its pane's corners from the lower left; null while one is refused. */
  readonly roofWindows?: readonly (readonly Point[])[] | null;
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

export interface Pv extends Sizer {
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

/** Instantiates the glue crate's release build. */
export async function loadPv(bytes: Uint8Array<ArrayBuffer>): Promise<Pv> {
  const { instance } = await WebAssembly.instantiate(bytes);
  const wasm = instance.exports;

  if (!isExports(wasm)) throw new TypeError("pv WASM lacks an export");

  /** The reply of export `name` to the JSON `input`. */
  const call = (name: Exported, input: string): string => {
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
    ...roofCalls(call),
    ...sizingCalls(call),
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
