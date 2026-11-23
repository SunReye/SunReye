// The `pv` crate's browser build through its glue crate, crates/pv-wasm (ADRs 17, 20). An export
// reads JSON and replies `{"ok": …}` or `{"error": "…"}`, packed as `ptr << 32 | len` in linear
// memory.

/** @import { Pv } from "./index.d.ts" */

import {
  isChimney,
  isFaces,
  isGeometry,
  isGhost,
  isGhosts,
  isIndex,
  isModules,
  isOpening,
  isPlaces,
  isRefit,
  isRoofWindow,
  isSizing,
  isSun,
  isVolts,
  isWatts,
  isYear,
  unwrap,
} from "./replies.js";

/**
 * An export that replies JSON to the JSON in linear memory at `input`.
 * @typedef {(input: number, inputLen: number) => bigint} Answer
 */

/**
 * The exports that reply JSON.
 * @typedef {object} Answers
 * @property {Answer} geometry
 * @property {Answer} modules
 * @property {Answer} sun
 * @property {Answer} clear_sky
 * @property {Answer} year
 * @property {Answer} neighbours
 * @property {Answer} cold_voltages
 * @property {Answer} sizing
 * @property {Answer} longest
 * @property {Answer} refit
 * @property {Answer} place
 * @property {Answer} glide
 * @property {Answer} chimney_at
 * @property {Answer} grid_at
 * @property {Answer} lay
 * @property {Answer} slide
 * @property {Answer} fill
 * @property {Answer} covered
 * @property {Answer} glide_window
 * @property {Answer} roof_window_at
 * @property {Answer} place_window
 */

/**
 * The ABI of crates/pv-wasm.
 * @typedef {object} Memory
 * @property {WebAssembly.Memory} memory
 * @property {(len: number) => number} reserve
 * @property {(ptr: number, len: number) => void} release
 */

/** @typedef {(name: keyof Answers, input: string) => string} Call */

/** @type {readonly (keyof Answers | "reserve" | "release")[]} */
const functions = [
  "reserve",
  "release",
  "geometry",
  "modules",
  "sun",
  "clear_sky",
  "year",
  "neighbours",
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
];

/**
 * @param {Readonly<WebAssembly.Exports>} exports
 * @returns {exports is Readonly<WebAssembly.Exports> & Memory & Answers}
 */
function isExports(exports) {
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

/**
 * What the crate answers while the builder edits the roof faces, through `call`.
 * @param {Call} call
 * @returns {Pick<Pv, "gridAt" | "lay" | "slide" | "fillFace" | "covered" | "glideWindow" | "roofWindowAt" | "placeWindow">}
 */
const roofCalls = (call) => ({
  gridAt: (scene, point) => unwrap(call("grid_at", JSON.stringify({ scene, point })), isIndex),
  lay: (on, from, to) => unwrap(call("lay", JSON.stringify({ ...on, from, to })), isGhosts),
  slide: (on, module, from, to) =>
    unwrap(call("slide", JSON.stringify({ ...on, module, from, to })), isGhost),
  fillFace: (on) => unwrap(call("fill", JSON.stringify(on)), isPlaces) ?? [],
  covered: (scene, sizes) =>
    unwrap(call("covered", JSON.stringify({ scene, sizes })), isPlaces) ?? [],
  glideWindow: (scene, index, shift) =>
    unwrap(call("glide_window", JSON.stringify({ scene, index, shift })), isRoofWindow),
  roofWindowAt: (scene, point) =>
    unwrap(call("roof_window_at", JSON.stringify({ scene, point })), isIndex),
  placeWindow: (scene, sizes, [width, length]) =>
    unwrap(call("place_window", JSON.stringify({ scene, sizes, width, length })), isRoofWindow),
});

/**
 * What the crate answers of the strings and the inverters' inputs, through `call`.
 * @param {Call} call
 * @returns {Pick<Pv, "coldVoltages" | "sizing" | "longest">}
 */
const stringCalls = (call) => ({
  coldVoltages: (moduleTypes, strings) =>
    unwrap(call("cold_voltages", JSON.stringify({ moduleTypes, strings })), isVolts),
  sizing: (moduleTypes, strings, inverters) =>
    unwrap(call("sizing", JSON.stringify({ moduleTypes, strings, inverters })), isSizing),
  longest: (moduleType, maxInputVoltage, limits) =>
    unwrap(call("longest", JSON.stringify({ moduleType, maxInputVoltage, limits })), isIndex),
});

/**
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {Promise<Pv>}
 */
export async function loadPv(bytes) {
  const { instance } = await WebAssembly.instantiate(bytes);
  const wasm = instance.exports;

  if (!isExports(wasm)) throw new TypeError("pv WASM lacks an export");

  /** @type {Call} */
  const call = (name, input) => {
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
    year: (run) => unwrap(call("year", JSON.stringify(run)), isYear),
    neighbours: (neighbours) => unwrap(call("neighbours", JSON.stringify(neighbours)), isFaces),
    refit: (scene, index, opening) =>
      unwrap(call("refit", JSON.stringify({ scene, index, opening })), isRefit),
    place: (scene, kind, usual) =>
      unwrap(call("place", JSON.stringify({ scene, kind, ...usual })), isOpening),
    glide: (scene, index, shift) =>
      unwrap(call("glide", JSON.stringify({ scene, index, shift })), isChimney),
    chimneyAt: (scene, point) =>
      unwrap(call("chimney_at", JSON.stringify({ scene, point })), isIndex),
    ...roofCalls(call),
    ...stringCalls(call),
  };
}
