// The `pv` crate in the browser through its glue crate, crates/pv-wasm (ADR 2, 20).

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
}

export type Obstacle =
  | {
      readonly kind: "box";
      readonly x: number;
      readonly z: number;
      readonly width: number;
      readonly depth: number;
      readonly height: number;
      readonly rotation: number;
    }
  | {
      readonly kind: "cylinder" | "tree";
      readonly x: number;
      readonly z: number;
      readonly radius: number;
      readonly height: number;
    };

/** A module in one cell: rows count up the slope, columns across it, from 0. */
export interface Cell {
  readonly row: number;
  readonly column: number;
  /** The string it is painted into; unassigned, it produces nothing. */
  readonly string?: number | null;
  readonly optimized?: boolean;
}

/** The modules on one roof face; cells are the module type's size plus a gap. */
export interface ModuleGrid {
  readonly block: number;
  /** The roof face's index in its block, as `roofs` lists them. */
  readonly face: number;
  readonly moduleType: number;
  /** Long side across the slope. */
  readonly landscape: boolean;
  /** Metres kept free along every edge. */
  readonly setback: number;
  readonly modules: readonly Cell[];
}

/** A side of a block's footprint: the front along +z, the right along +x. */
export type Wall = "front" | "right" | "back" | "left";

/** A marker for an inverter or a battery, on a block's wall. */
export interface Equipment {
  readonly device: number;
  readonly kind: "inverter" | "battery";
  readonly block: number;
  readonly wall: Wall;
  /** Metres from the wall's left end, seen from outside. */
  readonly along: number;
  /** Behind the wall, in the building. */
  readonly inside: boolean;
}

export type BodyClass = "sedan" | "hatchback" | "suv" | "van" | "pickup";

/** A parking footprint linked to an EVCC loadpoint; width along x, length along z. */
export interface CarPlace {
  readonly device: number;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly length: number;
  readonly rotation: number;
  /** The admin's pick of body, colour `#rrggbb`, and the id of an uploaded GLB. */
  readonly body?: { readonly class: BodyClass; readonly colour: string } | null;
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
}

/** A module's outline in metres; `height` is its long side. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A roof face as a module grid sees it. */
export interface RoofFace {
  readonly block: number;
  readonly face: number;
  readonly tilt: number;
  readonly azimuth: number;
  /** Metres across and up the slope from the lowest corner on the left, seen from the front. */
  readonly outline: readonly (readonly [number, number])[];
}

/** A cell whose module fits inside the setback. */
export interface CellPlace {
  readonly row: number;
  readonly column: number;
  /** Lower left and upper right corner in the face's outline. */
  readonly area: readonly [readonly [number, number], readonly [number, number]];
  readonly corners: readonly Point[];
}

/** Why the core would refuse to save the grids. */
export type Misplaced =
  | { readonly kind: "face" | "moduleType"; readonly grid: number }
  | {
      readonly kind: "setback" | "overlap";
      readonly grid: number;
      readonly row: number;
      readonly column: number;
    };

/** The roofs, each grid's cells (null for a missing face or module type) and the first misfit. */
export interface Modules {
  readonly roofs: readonly RoofFace[];
  readonly grids: readonly (readonly CellPlace[] | null)[];
  readonly misplaced: Misplaced | null;
}

export interface Face {
  readonly surface: "wall" | "roof" | "obstacle";
  /** A flat convex polygon. */
  readonly corners: readonly Point[];
}

export type Solid =
  | { readonly kind: "sphere"; readonly centre: Point; readonly radius: number }
  | {
      readonly kind: "cylinder";
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
}

export interface Pv {
  /** The scene's faces and solids; throws the crate's reason for a scene it cannot read. */
  geometry(scene: Scene): Geometry;
  /** The scene's module grids laid out, with module sizes by module type id. */
  modules(scene: Scene, sizes: Readonly<Record<number, Size>>): Modules;
}

/** The ABI of crates/pv-wasm: a reply is `ptr << 32 | len` of JSON in linear memory. */
interface Exports {
  readonly memory: WebAssembly.Memory;
  readonly reserve: (len: number) => number;
  readonly release: (ptr: number, len: number) => void;
  readonly geometry: (input: number, inputLen: number) => bigint;
  readonly modules: (input: number, inputLen: number) => bigint;
}

const functions = ["reserve", "release", "geometry", "modules"] as const;

function isExports(
  exports: Readonly<WebAssembly.Exports>,
): exports is Readonly<WebAssembly.Exports> & Exports {
  return (
    exports["memory"] instanceof WebAssembly.Memory &&
    functions.every((name) => {
      const value = exports[name];

      // A WASM export that is no memory, global or table is a function.
      return (
        value !== undefined &&
        !(value instanceof WebAssembly.Memory) &&
        !(value instanceof WebAssembly.Global) &&
        !(value instanceof WebAssembly.Table)
      );
    })
  );
}

type Reply<T> = { readonly ok: T } | { readonly error: string };

/** The `ok` of the crate's reply, or its error thrown. */
function unwrap<T>(text: string, guard: (value: unknown) => value is Reply<T>): T {
  const reply: unknown = JSON.parse(text);

  if (!guard(reply)) throw new TypeError(`pv WASM replied ${text}`);

  if ("error" in reply) throw new Error(reply.error);

  return reply.ok;
}

function isFailure(value: unknown): value is { readonly error: string } {
  return value instanceof Object && "error" in value && String(value.error) === value.error;
}

/** The glue crate's own shape is trusted past the top level's arrays. */
function isGeometry(value: unknown): value is Reply<Geometry> {
  return (
    isFailure(value) ||
    (value instanceof Object &&
      "ok" in value &&
      value.ok instanceof Object &&
      "faces" in value.ok &&
      Array.isArray(value.ok.faces) &&
      "solids" in value.ok &&
      Array.isArray(value.ok.solids))
  );
}

function isModules(value: unknown): value is Reply<Modules> {
  return (
    isFailure(value) ||
    (value instanceof Object &&
      "ok" in value &&
      value.ok instanceof Object &&
      "roofs" in value.ok &&
      Array.isArray(value.ok.roofs) &&
      "grids" in value.ok &&
      Array.isArray(value.ok.grids))
  );
}

/** Instantiates the glue crate's release build. */
export async function loadPv(bytes: Uint8Array<ArrayBuffer>): Promise<Pv> {
  const { instance } = await WebAssembly.instantiate(bytes);
  const wasm = instance.exports;

  if (!isExports(wasm)) throw new TypeError("pv WASM lacks an export");

  /** The reply of export `name` to the JSON `input`. */
  const call = (name: "geometry" | "modules", input: string): string => {
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
  };
}
