import { describe, expect, test } from "bun:test";
import { type PlantTexts, parsePlantFields, plantTextsFrom } from "./plant-fields";

/**
 * The plant form's fields are bound as text, so this is where "what did the
 * user actually mean" is decided: a blank box, a comma decimal, kW on screen
 * against watts in the record. The inverter's half (arrays, physics, battery)
 * has its own file: `./inverter-fields.test.ts`.
 */
const texts = (over: Partial<PlantTexts> = {}): PlantTexts => ({
  maxOutput: "10",
  houseLoad: "",
  smartMeterSince: "",
  ...over,
});

describe("parsePlantFields", () => {
  test("converts the kW fields to watts, which is what the record stores", () => {
    expect(parsePlantFields(texts())?.maxOutputW).toBe(10_000);
    expect(parsePlantFields(texts({ houseLoad: "0,4" }))?.houseLoadW).toBeCloseTo(400, 6);
  });

  test("treats a blank optional field as unset rather than as zero", () => {
    // Zero export limit means "may not feed in at all", which is a completely
    // different plant from "no limit stated".
    const parsed = parsePlantFields(texts({ maxOutput: "", houseLoad: "" }));
    expect(parsed?.maxOutputW).toBeNull();
    expect(parsed?.houseLoadW).toBeNull();
  });

  test("rejects a field that was filled in but cannot be read", () => {
    expect(parsePlantFields(texts({ maxOutput: "ten" }))).toBeNull();
    expect(parsePlantFields(texts({ houseLoad: "abc" }))).toBeNull();
  });

  test("turns an empty smart-meter date into null, so it can be cleared", () => {
    expect(parsePlantFields(texts({ smartMeterSince: "" }))?.smartMeterSince).toBeNull();
    expect(parsePlantFields(texts({ smartMeterSince: "2026-02-25" }))?.smartMeterSince).toBe(
      "2026-02-25",
    );
  });

  test("names no inverter fact — arrays, physics and the pack are the device's", () => {
    // A key here would be a key the weather PUT refuses (400), so the shape is
    // pinned: the plant form cannot grow one back by accident.
    expect(Object.keys(parsePlantFields(texts()) ?? {}).sort()).toEqual([
      "houseLoadW",
      "maxOutputW",
      "smartMeterSince",
    ]);
  });
});

describe("plantTextsFrom", () => {
  test("shows the power fields in kW, which is what the labels say", () => {
    expect(
      plantTextsFrom({
        maxOutputW: 10_000,
        houseLoadW: 350,
        smartMeterSince: null,
      }),
    ).toEqual({
      maxOutput: "10",
      houseLoad: "0.35",
      smartMeterSince: "",
    });
  });

  test("shows an unset optional field as blank, not as 0", () => {
    expect(
      plantTextsFrom({
        maxOutputW: null,
        houseLoadW: null,
        smartMeterSince: null,
      }).maxOutput,
    ).toBe("");
  });

  test("round-trips through the parser unchanged", () => {
    const original = {
      maxOutputW: 7000,
      houseLoadW: null,
      smartMeterSince: "2026-03-01",
    };
    expect(parsePlantFields(plantTextsFrom(original))).toEqual(original);
  });
});
