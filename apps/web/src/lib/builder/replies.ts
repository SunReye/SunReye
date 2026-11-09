// The pv glue crate's JSON replies, `{"ok": …}` or `{"error": "…"}`, checked at the boundary.
import type { Geometry, Modules, Sun } from "./pv.ts";

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

export function isModules(value: unknown): value is Reply<Modules> {
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

export function isWatts(value: unknown): value is Reply<number[][]> {
  return (
    isFailure(value) ||
    (value instanceof Object &&
      "ok" in value &&
      Array.isArray(value.ok) &&
      value.ok.every((row) => Array.isArray(row)))
  );
}
