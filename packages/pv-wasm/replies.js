// The glue crate's JSON replies, `{"ok": …}` or `{"error": "…"}`, checked at the boundary: the
// glue crate's own shape is trusted past the top level.

/** @import { Chimney, Opening, RoofWindow } from "@sunreye/scene" */
/**
 * @import { Cautious, Face, Geometry, Ghost, Location, Modules, Sizing, Sun, TypicalYear, Unfit, YearEnergy }
 *   from "./index.d.ts"
 */

/**
 * @template T
 * @typedef {{ readonly ok: T } | { readonly error: string }} Reply
 */

/**
 * The `ok` of the crate's reply, or its error thrown.
 * @template T
 * @param {string} text
 * @param {(value: unknown) => value is Reply<T>} guard
 * @returns {T}
 */
export function unwrap(text, guard) {
  /** @type {unknown} */
  const reply = JSON.parse(text);

  if (!guard(reply)) throw new TypeError(`pv WASM replied ${text}`);

  if ("error" in reply) throw new Error(reply.error);

  return reply.ok;
}

/**
 * @param {unknown} value
 * @returns {value is object}
 */
const isRecord = (value) => value instanceof Object;

/**
 * @param {unknown} value
 * @returns {value is { readonly error: string }}
 */
const isFailure = (value) =>
  isRecord(value) && "error" in value && String(value.error) === value.error;

/**
 * @param {unknown} value
 * @returns {value is Reply<Geometry>}
 */
export const isGeometry = (value) =>
  isFailure(value) ||
  (isRecord(value) &&
    "ok" in value &&
    isRecord(value.ok) &&
    "faces" in value.ok &&
    Array.isArray(value.ok.faces) &&
    "solids" in value.ok &&
    Array.isArray(value.ok.solids));

/**
 * @param {unknown} value
 * @returns {value is Reply<Face[]>}
 */
export const isFaces = (value) =>
  isFailure(value) || (isRecord(value) && "ok" in value && Array.isArray(value.ok));

/**
 * The roof faces and the grids, and what the builder's handles stand on.
 * @param {unknown} laid
 * @returns {laid is Pick<Modules, "roofs" | "grids" | "walls" | "footings">}
 */
const isLaid = (laid) =>
  isRecord(laid) &&
  "roofs" in laid &&
  Array.isArray(laid.roofs) &&
  "grids" in laid &&
  Array.isArray(laid.grids) &&
  "walls" in laid &&
  Array.isArray(laid.walls) &&
  "footings" in laid &&
  Array.isArray(laid.footings);

/**
 * @param {unknown} value
 * @returns {value is Reply<Modules>}
 */
export const isModules = (value) =>
  isFailure(value) || (isRecord(value) && "ok" in value && isLaid(value.ok));

/**
 * @param {unknown} value
 * @returns {value is Reply<Sun>}
 */
export const isSun = (value) =>
  isFailure(value) ||
  (isRecord(value) &&
    "ok" in value &&
    isRecord(value.ok) &&
    "zenith" in value.ok &&
    Number(value.ok.zenith) === value.ok.zenith &&
    "azimuth" in value.ok &&
    Number(value.ok.azimuth) === value.ok.azimuth);

/**
 * @param {unknown} value
 * @returns {value is Reply<(number | null)[]>}
 */
export const isVolts = (value) =>
  isFailure(value) ||
  (isRecord(value) &&
    "ok" in value &&
    Array.isArray(value.ok) &&
    value.ok.every((volts) => volts === null || Number.isFinite(volts)));

/**
 * @param {unknown} value
 * @returns {value is Reply<number[][]>}
 */
export const isWatts = (value) =>
  isFailure(value) ||
  (isRecord(value) &&
    "ok" in value &&
    Array.isArray(value.ok) &&
    value.ok.every((row) => Array.isArray(row)));

/**
 * @param {unknown} value
 * @returns {value is Reply<YearEnergy>}
 */
export const isYear = (value) =>
  isFailure(value) ||
  (isRecord(value) &&
    "ok" in value &&
    isRecord(value.ok) &&
    "strings" in value.ok &&
    Array.isArray(value.ok.strings) &&
    "inverters" in value.ok &&
    Array.isArray(value.ok.inverters));

/**
 * @param {unknown} value
 * @returns {value is Reply<Location>}
 */
export const isLocation = (value) =>
  isFailure(value) ||
  (isRecord(value) &&
    "ok" in value &&
    isRecord(value.ok) &&
    "latitude" in value.ok &&
    Number.isFinite(value.ok.latitude) &&
    "longitude" in value.ok &&
    Number.isFinite(value.ok.longitude));

/**
 * @param {unknown} value
 * @returns {value is Reply<TypicalYear>}
 */
export const isTypical = (value) =>
  isFailure(value) ||
  (isRecord(value) &&
    "ok" in value &&
    isRecord(value.ok) &&
    "weather" in value.ok &&
    isRecord(value.ok.weather) &&
    "sources" in value.ok &&
    Array.isArray(value.ok.sources));

/**
 * @param {unknown} value
 * @returns {value is Reply<number>}
 */
export const isNumber = (value) =>
  isFailure(value) || (isRecord(value) && "ok" in value && Number.isFinite(value.ok));

/**
 * @param {unknown} value
 * @returns {value is Reply<Cautious>}
 */
export const isCautious = (value) =>
  isFailure(value) ||
  (isRecord(value) &&
    "ok" in value &&
    isRecord(value.ok) &&
    "p50" in value.ok &&
    Number.isFinite(value.ok.p50) &&
    "p90" in value.ok &&
    Number.isFinite(value.ok.p90) &&
    "basis" in value.ok &&
    isRecord(value.ok.basis));

const KINDS = new Set(["start", "low", "high", "current", "uneven", "noInput"]);

/**
 * @param {unknown} item
 * @returns {item is Sizing}
 */
const isWarning = (item) => isRecord(item) && "kind" in item && KINDS.has(String(item.kind));

/**
 * @param {unknown} value
 * @returns {value is Reply<Sizing[]>}
 */
export const isSizing = (value) =>
  isFailure(value) ||
  (isRecord(value) && "ok" in value && Array.isArray(value.ok) && value.ok.every(isWarning));

/**
 * An index or a count, or null where the crate has none.
 * @param {unknown} value
 * @returns {value is Reply<number | null>}
 */
export const isIndex = (value) =>
  isFailure(value) ||
  (isRecord(value) && "ok" in value && (value.ok === null || Number.isInteger(value.ok)));

/**
 * An edit's answer: an object, or null where the crate has none.
 * @template T
 * @param {unknown} value
 * @returns {value is Reply<T>}
 */
const isAnswer = (value) =>
  isFailure(value) ||
  (isRecord(value) && "ok" in value && (value.ok === null || isRecord(value.ok)));

/** @type {(value: unknown) => value is Reply<{ readonly opening: Opening } | { readonly unfit: Unfit }>} */
export const isRefit = isAnswer;

/** @type {(value: unknown) => value is Reply<Opening | null>} */
export const isOpening = isAnswer;

/** @type {(value: unknown) => value is Reply<Chimney | null>} */
export const isChimney = isAnswer;

/** @type {(value: unknown) => value is Reply<RoofWindow | null>} */
export const isRoofWindow = isAnswer;

/** @type {(value: unknown) => value is Reply<Ghost | null>} */
export const isGhost = isAnswer;

/**
 * A list, or null where the crate has none; its items are the glue crate's own.
 * @template T
 * @param {unknown} value
 * @returns {value is Reply<T[] | null>}
 */
const isList = (value) =>
  isFailure(value) ||
  (isRecord(value) && "ok" in value && (value.ok === null || Array.isArray(value.ok)));

/** @type {(value: unknown) => value is Reply<Ghost[] | null>} */
export const isGhosts = isList;

/** @type {(value: unknown) => value is Reply<(readonly [number, number])[] | null>} */
export const isPlaces = isList;
