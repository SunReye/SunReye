// What the pv crate answers about the roof faces while the builder edits (ADR 20 Modules, Roof
// windows): the modules laid on them and the roof windows lying in them.
import type { Ghost } from "./laid.ts";
import type { Pv } from "./pv.ts";
import { isGhost, isIndex, isList, isRoofWindow, unwrap, type Exported } from "./replies.ts";

/** The reply of a glue crate's export to its JSON input. */
export type Call = (name: Exported, input: string) => string;

export type RoofCalls = Pick<
  Pv,
  | "gridAt"
  | "lay"
  | "slide"
  | "fillFace"
  | "covered"
  | "glideWindow"
  | "roofWindowAt"
  | "placeWindow"
>;

/** The crate's answers through `call`. */
export function roofCalls(call: Call): RoofCalls {
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
    glideWindow: (scene, index, shift) =>
      unwrap(call("glide_window", JSON.stringify({ scene, index, shift })), isRoofWindow),
    roofWindowAt: (scene, point) =>
      unwrap(call("roof_window_at", JSON.stringify({ scene, point })), isIndex),
    placeWindow: (scene, sizes, [width, length]) =>
      unwrap(call("place_window", JSON.stringify({ scene, sizes, width, length })), isRoofWindow),
  };
}
