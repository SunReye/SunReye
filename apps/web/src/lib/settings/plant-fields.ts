// The PLANT's own description, as the Plant tab edits it: what the grid
// connection will take, the house's baseline draw, and whether a smart-meter
// gateway is installed. PV arrays, panel physics and the battery used to be here
// too; they describe an INVERTER and moved to `./inverter-fields.ts`
// (2026-09-04) — one plant-wide set could not say whose roof was whose.

import { kwText, optionalKw } from "./field-text";

/** Every text field the plant form owns. */
export interface PlantTexts {
  /** kW in the UI, watts in the record. */
  maxOutput: string;
  houseLoad: string;
  /** `''` is the date input's "unset"; the record wants null. */
  smartMeterSince: string;
}

/** The record half this form writes. */
export interface PlantFields {
  maxOutputW: number | null;
  houseLoadW: number | null;
  smartMeterSince: string | null;
}

/**
 * The whole form as the record wants it, or null when any field is filled but
 * unparseable. All-or-nothing on purpose: a partial save would write half a plant.
 */
export function parsePlantFields(texts: PlantTexts): PlantFields | null {
  const maxOut = optionalKw(texts.maxOutput);
  const load = optionalKw(texts.houseLoad);
  if (!maxOut.ok || !load.ok) return null;
  return {
    maxOutputW: maxOut.watts,
    houseLoadW: load.watts,
    smartMeterSince: texts.smartMeterSince === "" ? null : texts.smartMeterSince,
  };
}

/** The stored half of the record this form edits. */
export type StoredPlant = PlantFields;

/** The stored record as the form's text fields. */
export function plantTextsFrom(stored: StoredPlant): PlantTexts {
  return {
    maxOutput: kwText(stored.maxOutputW),
    houseLoad: kwText(stored.houseLoadW),
    smartMeterSince: stored.smartMeterSince ?? "",
  };
}
