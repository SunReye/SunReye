// The pv glue crate's exports and its JSON replies, `{"ok": …}` or `{"error": "…"}`, checked
// at the boundary.
import type { Chimney, Geometry, Ghost, Modules, Opening, RoofWindow, Sun, Unfit } from "./pv.ts";

export type Reply<T> = { readonly ok: T } | { readonly error: string };

/** The `ok` of the crate's reply, or its error thrown. */
export function unwrap<T>(text: string, guard: (value: unknown) => value is Reply<T>): T {
  const reply: unknown = JSON.parse(text);

  if (!guard(reply)) throw new TypeError(`pv WASM replied ${text}`);

  if ("error" in reply) throw new Error(reply.error);

  return reply.ok;
}

function isFailure(value: unknown): value is { readonly error: string } {
  return value instanceof Object && "error" in value && String(value.error) === value.error;
}

/** The glue crate's own shape is trusted past the top level's arrays. */
export function isGeometry(value: unknown): value is Reply<Geometry> {
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

/** The grids' layout: the roof faces and each grid on its face. */
const isGridded = (laid: unknown): laid is Pick<Modules, "roofs" | "grids"> =>
  laid instanceof Object &&
  "roofs" in laid &&
  Array.isArray(laid.roofs) &&
  "grids" in laid &&
  Array.isArray(laid.grids);

/** What the handles stand on: the walls and the chimneys' footings. */
const isStoodOn = (laid: unknown): laid is Pick<Modules, "walls" | "footings"> =>
  laid instanceof Object &&
  "walls" in laid &&
  Array.isArray(laid.walls) &&
  "footings" in laid &&
  Array.isArray(laid.footings);

export function isModules(value: unknown): value is Reply<Modules> {
  return (
    isFailure(value) ||
    (value instanceof Object && "ok" in value && isGridded(value.ok) && isStoodOn(value.ok))
  );
}

export function isSun(value: unknown): value is Reply<Sun> {
  return (
    isFailure(value) ||
    (value instanceof Object &&
      "ok" in value &&
      value.ok instanceof Object &&
      "zenith" in value.ok &&
      Number(value.ok.zenith) === value.ok.zenith &&
      "azimuth" in value.ok &&
      Number(value.ok.azimuth) === value.ok.azimuth)
  );
}

export function isVolts(value: unknown): value is Reply<(number | null)[]> {
  return (
    isFailure(value) ||
    (value instanceof Object &&
      "ok" in value &&
      Array.isArray(value.ok) &&
      value.ok.every((volts) => volts === null || Number.isFinite(volts)))
  );
}

export function isWatts(value: unknown): value is Reply<number[][]> {
  return (
    isFailure(value) ||
    (value instanceof Object &&
      "ok" in value &&
      Array.isArray(value.ok) &&
      value.ok.every((row) => Array.isArray(row)))
  );
}

const isRecord = (value: unknown): value is object => value instanceof Object;

/** An edit's answer: an object, or null where the crate has none. */
function isAnswer<T>(value: unknown): value is Reply<T> {
  return (
    isFailure(value) ||
    (isRecord(value) && "ok" in value && (value.ok === null || isRecord(value.ok)))
  );
}

export const isRefit: (
  value: unknown,
) => value is Reply<{ readonly opening: Opening } | { readonly unfit: Unfit }> = isAnswer;

export const isOpening: (value: unknown) => value is Reply<Opening | null> = isAnswer;

export const isChimney: (value: unknown) => value is Reply<Chimney | null> = isAnswer;

export const isRoofWindow: (value: unknown) => value is Reply<RoofWindow | null> = isAnswer;

export const isGhost: (value: unknown) => value is Reply<Ghost | null> = isAnswer;

/** A list, or null where the crate has none; its items are the glue crate's own. */
export function isList<T>(value: unknown): value is Reply<T[] | null> {
  return (
    isFailure(value) ||
    (isRecord(value) && "ok" in value && (value.ok === null || Array.isArray(value.ok)))
  );
}

export function isIndex(value: unknown): value is Reply<number | null> {
  return (
    isFailure(value) ||
    (isRecord(value) && "ok" in value && (value.ok === null || Number.isInteger(value.ok)))
  );
}

/** The ABI of crates/pv-wasm: a reply is `ptr << 32 | len` of JSON in linear memory. */
export interface Exports {
  readonly memory: WebAssembly.Memory;
  readonly reserve: (len: number) => number;
  readonly release: (ptr: number, len: number) => void;
  readonly geometry: (input: number, inputLen: number) => bigint;
  readonly modules: (input: number, inputLen: number) => bigint;
  readonly sun: (input: number, inputLen: number) => bigint;
  readonly clear_sky: (input: number, inputLen: number) => bigint;
  readonly cold_voltages: (input: number, inputLen: number) => bigint;
  readonly sizing: (input: number, inputLen: number) => bigint;
  readonly longest: (input: number, inputLen: number) => bigint;
  readonly refit: (input: number, inputLen: number) => bigint;
  readonly place: (input: number, inputLen: number) => bigint;
  readonly glide: (input: number, inputLen: number) => bigint;
  readonly chimney_at: (input: number, inputLen: number) => bigint;
  readonly grid_at: (input: number, inputLen: number) => bigint;
  readonly lay: (input: number, inputLen: number) => bigint;
  readonly slide: (input: number, inputLen: number) => bigint;
  readonly fill: (input: number, inputLen: number) => bigint;
  readonly covered: (input: number, inputLen: number) => bigint;
  readonly glide_window: (input: number, inputLen: number) => bigint;
  readonly roof_window_at: (input: number, inputLen: number) => bigint;
  readonly place_window: (input: number, inputLen: number) => bigint;
}

const functions = [
  "reserve",
  "release",
  "geometry",
  "modules",
  "sun",
  "clear_sky",
  "cold_voltages",
  "sizing",
  "longest",
  "refit",
  "place",
  "glide",
  "chimney_at",
  "grid_at",
  "lay",
  "slide",
  "fill",
  "covered",
  "glide_window",
  "roof_window_at",
  "place_window",
] as const;

export function isExports(
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

/** An export that answers JSON. */
export type Exported = Exclude<(typeof functions)[number], "reserve" | "release">;
