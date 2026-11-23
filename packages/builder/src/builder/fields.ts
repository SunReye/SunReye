// The bounds and steps of the builder's numbers and choices, for the value editor (ADR 21).
import type { Editable } from "../components/value-editor/editable.ts";

/** Metres either way from the first block's corner. */
export const REACH = 200;

/** Lengths to the decimetre, as handles snap them (ADR 20). */
export function metres(name: string, min: number, max: number, step = 0.1): Editable {
  return { kind: "number", name, unit: "m", min, max, step };
}

/** Whole degrees. */
export function degrees(name: string, min: number, max: number): Editable {
  return { kind: "number", name, unit: "°", min, max, step: 1 };
}

/** A count or a percentage. */
export function amount(name: string, min: number, max: number, step = 1): Editable {
  return { kind: "number", name, unit: "", min, max, step };
}

/** One of `options`, by its position. */
export function choices(name: string, options: readonly string[]): Editable {
  return { kind: "enum", name, options: options.map((text, value) => ({ value, text })) };
}
