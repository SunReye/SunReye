// The INVERTER's own description, as the device dialog edits it: the PV arrays it
// converts, the panel physics they obey, and the pack it carries. These moved
// here from the plant form (2026-09-04) because a second inverter made one
// plant-wide list unable to say whose strings were whose.

import { DEFAULT_RESERVE_PCT, kwText, num, optionalKw } from "./field-text";

/**
 * Per-array overrides this form has NO input for — a datasheet coefficient or a
 * per-string loss an operator sets once from a document. Carried as an opaque
 * bag, out exactly as it came in, so an unrelated edit cannot erase them.
 * Mirrors `pvArraySchema` in `packages/db/src/weather.ts`.
 */
export type PvArrayOverrides = {
  deviceSlug?: string;
  tempCoefficient?: number;
  systemLoss?: number;
};

export type ArrayText = {
  kwp: string;
  tilt: string;
  azimuth: string;
  /** Carried, never edited — see {@link PvArrayOverrides}. Absent when none. */
  overrides?: PvArrayOverrides;
};

export type PvArray = {
  kwp: number;
  tilt: number;
  azimuth: number;
} & PvArrayOverrides;

export type Battery = {
  usableKwh: number;
  maxChargeW: number | null;
  minSoc: number;
  nominalV: number | null;
};

/** Every text field the inverter section owns. */
export interface InverterTexts {
  arrays: ArrayText[];
  tempCoeff: string;
  loss: string;
  battUsable: string;
  /** kW in the UI, watts in the record. */
  battCharge: string;
  battReserve: string;
  /** Nominal pack voltage, V. Blank = never stated (see Battery.nominalV). */
  battNominalV: string;
}

/** The device fields the section writes. */
export interface InverterFields {
  arrays: PvArray[];
  tempCoefficient: number;
  systemLoss: number;
  battery: Battery | null;
}

/** What a device row carries of this — the read side of {@link inverterTextsFrom}. */
export type StoredInverter = InverterFields;

/** The column defaults, as texts — what a NEW inverter's section opens with. */
export const DEFAULT_INVERTER_TEXTS: InverterTexts = {
  arrays: [],
  tempCoeff: "-0.4",
  loss: "14",
  battUsable: "",
  battCharge: "",
  battReserve: "",
  battNominalV: "",
};

function parseArray(t: ArrayText): PvArray | null {
  const kwp = num(t.kwp);
  const tilt = num(t.tilt);
  const azimuth = num(t.azimuth);
  if (kwp === null || tilt === null || azimuth === null) return null;
  // Spread last but never defaulted: an array that stated nothing gets no keys,
  // because `systemLoss: undefined` re-validates as a stated field to anything
  // reading keys, and a `{}` bag would make every new array claim 0 %.
  return { kwp, tilt, azimuth, ...t.overrides };
}

/**
 * The battery block exists only when a usable capacity is given: an inverter with
 * no storage leaves the whole group blank, and a reserve without a capacity
 * describes nothing. The reserve then defaults rather than failing — it is the
 * one field here with a sensible answer for someone who did not think about it.
 */
function parseBattery(texts: InverterTexts, maxChargeW: number | null) {
  const none = { ok: true, battery: null as Battery | null };
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
 * The section as the device wants it, or null when any field is filled but
 * unparseable. All-or-nothing on purpose: a partial save would write half a roof.
 */
export function parseInverterFields(texts: InverterTexts): InverterFields | null {
  const arrays: PvArray[] = [];
  for (const t of texts.arrays) {
    const parsed = parseArray(t);
    if (parsed === null) return null;
    arrays.push(parsed);
  }
  const tempCoefficient = num(texts.tempCoeff);
  const systemLoss = num(texts.loss);
  if (tempCoefficient === null || systemLoss === null) return null;
  const charge = optionalKw(texts.battCharge);
  if (!charge.ok) return null;
  const battery = parseBattery(texts, charge.watts);
  if (!battery.ok) return null;
  return { arrays, tempCoefficient, systemLoss, battery: battery.battery };
}

/** A stored inverter as the section's text fields. */
export function inverterTextsFrom(stored: StoredInverter): InverterTexts {
  const battery = stored.battery;
  return {
    arrays: stored.arrays.map(({ kwp, tilt, azimuth, ...overrides }) => ({
      kwp: kwp.toString(),
      tilt: tilt.toString(),
      azimuth: azimuth.toString(),
      // Destructured rest rather than three named copies: a field added to the
      // record and forgotten here would be silently erased on the next save.
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    })),
    tempCoeff: stored.tempCoefficient.toString(),
    loss: stored.systemLoss.toString(),
    battUsable: battery ? battery.usableKwh.toString() : "",
    battCharge: battery ? kwText(battery.maxChargeW) : "",
    battReserve: battery ? battery.minSoc.toString() : "",
    battNominalV: battery?.nominalV?.toString() ?? "",
  };
}
