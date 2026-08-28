import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RESERVE_PCT,
  parsePlantFields,
  plantTextsFrom,
  type PlantTexts,
  type StoredPlant,
} from "./plant-fields";

/**
 * The plant form's fields are bound as text, so this is where "what did the
 * user actually mean" is decided: a blank box, a comma decimal, kW on screen
 * against watts in the record, and a battery group that only exists when there
 * is a battery.
 */
const texts = (over: Partial<PlantTexts> = {}): PlantTexts => ({
  arrays: [{ kwp: "9.8", tilt: "30", azimuth: "-15" }],
  tempCoeff: "-0.4",
  loss: "14",
  maxOutput: "10",
  houseLoad: "",
  battUsable: "15",
  battCharge: "5",
  battReserve: "10",
  battNominalV: "51.2",
  smartMeterSince: "",
  ...over,
});

describe("parsePlantFields", () => {
  test("converts the kW fields to watts, which is what the record stores", () => {
    const parsed = parsePlantFields(texts());
    expect(parsed?.maxOutputW).toBe(10_000);
    expect(parsed?.battery?.maxChargeW).toBe(5_000);
    // kWh is NOT converted — the battery is stated in kWh on both sides.
    expect(parsed?.battery?.usableKwh).toBe(15);
  });

  test("keeps the array geometry as entered, including a negative azimuth", () => {
    // 0 = south, -90 = east. A sign lost here silently points the array the
    // wrong way and the forecast is wrong all afternoon.
    expect(parsePlantFields(texts())?.arrays).toEqual([{ kwp: 9.8, tilt: 30, azimuth: -15 }]);
  });

  test("accepts a comma decimal, which is what a German keyboard produces", () => {
    expect(parsePlantFields(texts({ tempCoeff: "-0,4" }))?.tempCoefficient).toBeCloseTo(-0.4, 10);
  });

  test("treats a blank optional field as unset rather than as zero", () => {
    // Zero export limit means "may not feed in at all", which is a completely
    // different plant from "no limit stated".
    const parsed = parsePlantFields(texts({ maxOutput: "", houseLoad: "" }));
    expect(parsed?.maxOutputW).toBeNull();
    expect(parsed?.houseLoadW).toBeNull();
  });

  test("rejects a field that was filled in but cannot be read", () => {
    for (const bad of [{ maxOutput: "ten" }, { tempCoeff: "" }, { loss: "abc" }]) {
      expect(parsePlantFields(texts(bad))).toBeNull();
    }
  });

  test("rejects an array with any incomplete corner, rather than dropping it", () => {
    // Silently discarding a half-typed surface loses PV the owner believes is
    // configured.
    expect(
      parsePlantFields(texts({ arrays: [{ kwp: "9.8", tilt: "", azimuth: "0" }] })),
    ).toBeNull();
  });

  test("accepts a plant with no arrays at all", () => {
    expect(parsePlantFields(texts({ arrays: [] }))?.arrays).toEqual([]);
  });

  test("omits the battery entirely when no capacity is stated", () => {
    // A reserve or a charge limit without a capacity describes nothing, so the
    // whole block is absent rather than half-filled.
    const parsed = parsePlantFields(texts({ battUsable: "", battReserve: "20", battCharge: "5" }));
    expect(parsed?.battery).toBeNull();
  });

  test("defaults the reserve when it is left blank, but not the capacity", () => {
    const parsed = parsePlantFields(texts({ battReserve: "" }));
    expect(parsed?.battery?.minSoc).toBe(DEFAULT_RESERVE_PCT);
    expect(parsePlantFields(texts({ battUsable: "nope" }))).toBeNull();
  });

  test("keeps a battery with no charge limit — that field is optional", () => {
    expect(parsePlantFields(texts({ battCharge: "" }))?.battery).toEqual({
      usableKwh: 15,
      maxChargeW: null,
      minSoc: 10,
      nominalV: 51.2,
    });
  });

  test("turns an empty smart-meter date into null, so it can be cleared", () => {
    expect(parsePlantFields(texts({ smartMeterSince: "" }))?.smartMeterSince).toBeNull();
    expect(parsePlantFields(texts({ smartMeterSince: "2026-02-25" }))?.smartMeterSince).toBe(
      "2026-02-25",
    );
  });
});

describe("the battery's nominal voltage", () => {
  test("is kept as entered", () => {
    expect(parsePlantFields(texts({ battNominalV: "48" }))?.battery?.nominalV).toBe(48);
  });

  test("stays null when blank, which is not the same as 51.2", () => {
    // Null tells the automation engine to keep whatever this install already had
    // on the automations page, where this field used to live. A default would
    // rescale every commanded current on a 48 V pack by 7 %, silently.
    expect(parsePlantFields(texts({ battNominalV: "" }))?.battery?.nominalV).toBeNull();
  });

  test("rejects a voltage that was typed but cannot be read", () => {
    expect(parsePlantFields(texts({ battNominalV: "fifty" }))).toBeNull();
  });

  test("is absent along with the rest of the block when no battery is stated", () => {
    expect(parsePlantFields(texts({ battUsable: "", battNominalV: "48" }))?.battery).toBeNull();
  });
});

describe("plantTextsFrom", () => {
  const stored = (over: Partial<StoredPlant> = {}): StoredPlant => ({
    arrays: [{ kwp: 9.8, tilt: 30, azimuth: -15 }],
    tempCoefficient: -0.4,
    systemLoss: 14,
    maxOutputW: 10_000,
    houseLoadW: null,
    battery: { usableKwh: 15, maxChargeW: 5_000, minSoc: 10, nominalV: null },
    smartMeterSince: null,
    ...over,
  });

  test("shows the power fields in kW, which is what the labels say", () => {
    const texts = plantTextsFrom(stored());
    expect(texts.maxOutput).toBe("10");
    expect(texts.battCharge).toBe("5");
  });

  test("shows an unset optional field as blank, not as 0", () => {
    const texts = plantTextsFrom(stored({ houseLoadW: null, smartMeterSince: null }));
    expect(texts.houseLoad).toBe("");
    expect(texts.smartMeterSince).toBe("");
  });

  test("blanks the whole battery group when there is no battery", () => {
    const texts = plantTextsFrom(stored({ battery: null }));
    expect([texts.battUsable, texts.battCharge, texts.battReserve]).toEqual(["", "", ""]);
  });

  test("fills the voltage from the automation's old value when the plant has none", () => {
    // The carry-over that makes the field honest: an install that set 48 V on
    // the automations page must open this one showing 48 V. A blank box would
    // read as "nothing is set" while the engine was still using 48.
    expect(plantTextsFrom(stored(), 48).battNominalV).toBe("48");
  });

  test("prefers the plant's own voltage once it has been stated", () => {
    const withVolts = stored({
      battery: { usableKwh: 15, maxChargeW: null, minSoc: 10, nominalV: 51.2 },
    });
    expect(plantTextsFrom(withVolts, 48).battNominalV).toBe("51.2");
  });

  test("is blank only when neither source has one", () => {
    expect(plantTextsFrom(stored()).battNominalV).toBe("");
    expect(plantTextsFrom(stored(), null).battNominalV).toBe("");
  });

  test("round-trips through the parser unchanged", () => {
    // The two halves are inverses; a unit mismatch in either would show up here
    // as watts becoming kilowatts on every save.
    const original = stored();
    expect(parsePlantFields(plantTextsFrom(original))).toEqual({
      ...original,
      battery: { ...original.battery!, nominalV: null },
    });
  });
});

/**
 * The per-array overrides — `deviceSlug`, `tempCoefficient`, `systemLoss` — have
 * NO input on this form, and that is the decision. They are datasheet and
 * per-string numbers an operator sets once from a document, and the plant
 * columns beside them remain the answer for the uniform single-array plant this
 * form is shaped for.
 *
 * Which makes the round trip below the whole risk of that decision. This form
 * does a read-modify-write of the `arrays` list and NAMES it in the request
 * (`plant-form.svelte`, and `plant-fields-placement.test.ts` on why it names
 * rather than spreads), so a parser that rebuilt each entry from its three text
 * boxes would erase every override on the next unrelated save — an operator
 * changing the export limit silently reverting the east string's 25 % loss. That
 * is the exact bug class the placement test exists for, one layer in.
 *
 * So the overrides ride through as an opaque `overrides` bag: not text, not
 * editable, not defaulted, and byte-identical on the way out.
 */
describe("per-array overrides the form does not edit", () => {
  const withOverrides = (): StoredPlant => ({
    arrays: [
      { kwp: 5, tilt: 20, azimuth: -90, deviceSlug: "east-inv", systemLoss: 25 },
      { kwp: 9.8, tilt: 30, azimuth: 0, tempCoefficient: -0.29 },
    ],
    tempCoefficient: -0.4,
    systemLoss: 14,
    maxOutputW: 10_000,
    houseLoadW: null,
    battery: null,
    smartMeterSince: null,
  });

  test("survive a save round-trip untouched", () => {
    const original = withOverrides();
    expect(parsePlantFields(plantTextsFrom(original))?.arrays).toEqual(original.arrays);
  });

  test("survive a save that EDITS the array's geometry", () => {
    // The realistic case: the operator retilts the east string, and the loss
    // figure they entered from the installer's report has to still be there.
    const texts = plantTextsFrom(withOverrides());
    texts.arrays[0]!.tilt = "35";
    expect(parsePlantFields(texts)?.arrays[0]).toEqual({
      kwp: 5,
      tilt: 35,
      azimuth: -90,
      deviceSlug: "east-inv",
      systemLoss: 25,
    });
  });

  test("do not appear on an array that never had them", () => {
    // No key, not `undefined`: the value is round-tripped into JSONB and
    // re-validated, and an invented `systemLoss: undefined` would read as a
    // stated field to anything that inspects keys.
    const parsed = parsePlantFields(plantTextsFrom(withOverrides()));
    expect(Object.keys(parsed?.arrays[1] ?? {}).sort()).toEqual([
      "azimuth",
      "kwp",
      "tempCoefficient",
      "tilt",
    ]);
    const plain = parsePlantFields(texts({ arrays: [{ kwp: "1", tilt: "1", azimuth: "1" }] }));
    expect(Object.keys(plain?.arrays[0] ?? {}).sort()).toEqual(["azimuth", "kwp", "tilt"]);
  });

  test("are dropped along with the array when its geometry is unparseable", () => {
    // All-or-nothing is unchanged: a half-typed tilt still fails the whole save
    // rather than writing an array with overrides and no orientation.
    const texts = plantTextsFrom(withOverrides());
    texts.arrays[0]!.tilt = "";
    expect(parsePlantFields(texts)).toBeNull();
  });

  test("a newly added array carries none, and that is not a blank statement", () => {
    // The form's own "add array" button produces three empty text boxes and no
    // `overrides` key. Absent must stay absent: a `{}` bag or a zeroed one would
    // make every new array claim a 0 % loss.
    const parsed = parsePlantFields(texts({ arrays: [{ kwp: "3", tilt: "10", azimuth: "0" }] }));
    expect(parsed?.arrays).toEqual([{ kwp: 3, tilt: 10, azimuth: 0 }]);
  });
});
