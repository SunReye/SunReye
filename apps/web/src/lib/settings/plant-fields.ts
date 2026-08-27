/**
 * Turning the plant form's text inputs into the stored record.
 *
 * Extracted from the form because it is the part with rules: which blanks are
 * allowed, which unit each field is shown in, and when a battery block exists at
 * all. Inside a component none of that is reachable by a test.
 *
 * Every numeric field is bound as TEXT in the form, so a half-typed "-" or an
 * empty box never coerces to 0. Parsing happens once, here, on save.
 */

export type ArrayText = { kwp: string; tilt: string; azimuth: string };

export type PvArray = { kwp: number; tilt: number; azimuth: number };
export type PlantBattery = {
  usableKwh: number;
  maxChargeW: number | null;
  minSoc: number;
  nominalV: number | null;
};

/** Every text field the plant form owns. */
export interface PlantTexts {
  arrays: ArrayText[];
  tempCoeff: string;
  loss: string;
  /** kW in the UI, watts in the record. */
  maxOutput: string;
  houseLoad: string;
  battUsable: string;
  battCharge: string;
  battReserve: string;
  /** Nominal pack voltage, V. Blank = never stated (see PlantBattery.nominalV). */
  battNominalV: string;
  /** `''` is the date input's "unset"; the record wants null. */
  smartMeterSince: string;
}

/** The record half this form writes. */
export interface PlantFields {
  arrays: PvArray[];
  tempCoefficient: number;
  systemLoss: number;
  maxOutputW: number | null;
  houseLoadW: number | null;
  battery: PlantBattery | null;
  smartMeterSince: string | null;
}

/** Reserve floor when the field is left blank. */
// fallow-ignore-next-line unused-export -- exported so plant-fields.test.ts asserts the default rather than restating the number; test files are not traced as consumers.
export const DEFAULT_RESERVE_PCT = 10;

/** A finite number, or null — `Number("")` is 0 and `parseFloat("12abc")` is 12. */
function num(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/** A blank field is a valid "unset"; a filled-but-unparseable one is not. */
function optionalKw(text: string): { ok: boolean; watts: number | null } {
  if (text.trim() === "") return { ok: true, watts: null };
  const kw = num(text);
  return kw === null ? { ok: false, watts: null } : { ok: true, watts: kw * 1000 };
}

function parseArray(t: ArrayText): PvArray | null {
  const kwp = num(t.kwp);
  const tilt = num(t.tilt);
  const azimuth = num(t.azimuth);
  if (kwp === null || tilt === null || azimuth === null) return null;
  return { kwp, tilt, azimuth };
}

/**
 * The battery block exists only when a usable capacity is given: a plant with no
 * storage leaves the whole group blank, and a reserve without a capacity
 * describes nothing. The reserve then defaults rather than failing — it is the
 * one field here with a sensible answer for someone who did not think about it.
 */
function parseBattery(texts: PlantTexts, maxChargeW: number | null) {
  const none = { ok: true, battery: null as PlantBattery | null };
  if (texts.battUsable.trim() === "") return none;
  const usableKwh = num(texts.battUsable);
  const minSoc = texts.battReserve.trim() === "" ? DEFAULT_RESERVE_PCT : num(texts.battReserve);
  // Blank voltage stays null rather than defaulting: null is what tells the
  // automation engine to keep using whatever this install already had, instead
  // of quietly rescaling every commanded current to 51.2 V.
  const blankVolts = texts.battNominalV.trim() === "";
  const nominalV = blankVolts ? null : num(texts.battNominalV);
  if (usableKwh === null || minSoc === null) return { ...none, ok: false };
  if (!blankVolts && nominalV === null) return { ...none, ok: false };
  return { ok: true, battery: { usableKwh, maxChargeW, minSoc, nominalV } };
}

/**
 * The whole form as the record wants it, or null when any field is filled but
 * unparseable.
 *
 * All-or-nothing on purpose: a partial save would write half a plant and leave
 * the reader to guess which half, and everything here feeds models that read
 * these fields together.
 */
export function parsePlantFields(texts: PlantTexts): PlantFields | null {
  const arrays: PvArray[] = [];
  for (const t of texts.arrays) {
    const parsed = parseArray(t);
    if (parsed === null) return null;
    arrays.push(parsed);
  }
  const tempCoefficient = num(texts.tempCoeff);
  const systemLoss = num(texts.loss);
  if (tempCoefficient === null || systemLoss === null) return null;

  const maxOut = optionalKw(texts.maxOutput);
  const load = optionalKw(texts.houseLoad);
  const charge = optionalKw(texts.battCharge);
  if (!maxOut.ok || !load.ok || !charge.ok) return null;

  const battery = parseBattery(texts, charge.watts);
  if (!battery.ok) return null;

  return {
    arrays,
    tempCoefficient,
    systemLoss,
    maxOutputW: maxOut.watts,
    houseLoadW: load.watts,
    battery: battery.battery,
    smartMeterSince: texts.smartMeterSince === "" ? null : texts.smartMeterSince,
  };
}

/** The stored half of the record this form edits. */
export interface StoredPlant {
  arrays: PvArray[];
  tempCoefficient: number;
  systemLoss: number;
  maxOutputW: number | null;
  houseLoadW: number | null;
  battery: PlantBattery | null;
  smartMeterSince: string | null;
}

/** Watts as kW text; blank when unset. */
const kwText = (w: number | null | undefined) => (w == null ? "" : (w / 1000).toString());

/**
 * The stored record as the form's text fields.
 *
 * `legacyNominalV` is the pack voltage's old home — it was a peak-shaving field
 * before it was a plant one. An install that set 48 V there must OPEN this page
 * showing 48 V, not an empty box: blank would read as "nothing is set" while the
 * engine was quietly still using 48. So whatever this shows is what the engine
 * is using, and the first save moves it into the plant record for good.
 */
export function plantTextsFrom(stored: StoredPlant, legacyNominalV?: number | null): PlantTexts {
  const battery = stored.battery;
  return {
    arrays: stored.arrays.map((a) => ({
      kwp: a.kwp.toString(),
      tilt: a.tilt.toString(),
      azimuth: a.azimuth.toString(),
    })),
    tempCoeff: stored.tempCoefficient.toString(),
    loss: stored.systemLoss.toString(),
    maxOutput: kwText(stored.maxOutputW),
    houseLoad: kwText(stored.houseLoadW),
    battUsable: battery ? battery.usableKwh.toString() : "",
    battCharge: battery ? kwText(battery.maxChargeW) : "",
    battReserve: battery ? battery.minSoc.toString() : "",
    battNominalV: (battery?.nominalV ?? legacyNominalV)?.toString() ?? "",
    smartMeterSince: stored.smartMeterSince ?? "",
  };
}
