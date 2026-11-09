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

/** The scene's frame: metres, y up, origin at the first block's corner (ADR 20). */
export interface Scene {
  /** The compass bearing of the scene's −z axis, in degrees. */
  readonly north: number;
  readonly blocks: readonly Block[];
  readonly obstacles: readonly Obstacle[];
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

/** What the crate draws and shades. */
export interface Geometry {
  readonly faces: readonly Face[];
  readonly solids: readonly Solid[];
}

export interface Pv {
  /** The scene's faces and solids; throws the crate's reason for a scene it cannot read. */
  geometry(scene: Scene): Geometry;
}

/** The ABI of crates/pv-wasm: a reply is `ptr << 32 | len` of JSON in linear memory. */
interface Exports {
  readonly memory: WebAssembly.Memory;
  readonly reserve: (len: number) => number;
  readonly release: (ptr: number, len: number) => void;
  readonly geometry: (scene: number, sceneLen: number) => bigint;
}

type Reply = { readonly ok: Geometry } | { readonly error: string };

const functions = ["reserve", "release", "geometry"] as const;

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

/** The crate's reply; the glue crate's own shape is trusted past its top level. */
function isReply(value: unknown): value is Reply {
  if (!(value instanceof Object)) return false;

  if ("error" in value) return String(value.error) === value.error;

  return (
    "ok" in value &&
    value.ok instanceof Object &&
    "faces" in value.ok &&
    Array.isArray(value.ok.faces) &&
    "solids" in value.ok &&
    Array.isArray(value.ok.solids)
  );
}

/** Instantiates the glue crate's release build. */
export async function loadPv(bytes: Uint8Array<ArrayBuffer>): Promise<Pv> {
  const { instance } = await WebAssembly.instantiate(bytes);
  const wasm = instance.exports;

  if (!isExports(wasm)) throw new TypeError("pv WASM lacks an export");

  return {
    geometry: (scene) => {
      const input = new TextEncoder().encode(JSON.stringify(scene));
      const at = wasm.reserve(input.length);

      new Uint8Array(wasm.memory.buffer, at, input.length).set(input);

      const packed = wasm.geometry(at, input.length);

      wasm.release(at, input.length);

      const [ptr, len] = [Number(packed >> 32n), Number(packed & 0xffff_ffffn)];
      const text = new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, ptr, len));

      wasm.release(ptr, len);

      const reply: unknown = JSON.parse(text);

      if (!isReply(reply)) throw new TypeError(`pv WASM replied ${text}`);

      if ("error" in reply) throw new Error(reply.error);

      return reply.ok;
    },
  };
}
