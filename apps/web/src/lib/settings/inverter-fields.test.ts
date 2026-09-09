import { describe, expect, test } from "bun:test";
import { DEFAULT_RESERVE_PCT } from "./field-text";
import {
  DEFAULT_INVERTER_TEXTS,
  type InverterTexts,
  type StoredInverter,
  inverterTextsFrom,
  parseInverterFields,
} from "./inverter-fields";

/**
 * The inverter section of the device dialog is bound as text, so this is where
 * "what did the user actually mean" is decided: a blank box, a comma decimal,
 * kW on screen against watts in the record, and a battery group that only
 * exists when there is a battery.
 */
const texts = (over: Partial<InverterTexts> = {}): InverterTexts => ({
  arrays: [{ kwp: "9.8", tilt: "30", azimuth: "-15" }],
  tempCoeff: "-0.4",
  loss: "14",
  battUsable: "15",
  battCharge: "5",
  battReserve: "10",
  battNominalV: "51.2",
  ...over,
});

describe("parseInverterFields", () => {
  test("converts the charge power to watts and keeps kWh as kWh", () => {
    const parsed = parseInverterFields(texts());
    expect(parsed?.battery?.maxChargeW).toBe(5_000);
    expect(parsed?.battery?.usableKwh).toBe(15);
  });

  test("keeps the array geometry as entered, including a negative azimuth", () => {
    // 0 = south, -90 = east. A sign lost here silently points the array the
    // wrong way and the forecast is wrong all afternoon.
    expect(parseInverterFields(texts())?.arrays).toEqual([{ kwp: 9.8, tilt: 30, azimuth: -15 }]);
  });

  test("accepts a comma decimal, which is what a German keyboard produces", () => {
    expect(parseInverterFields(texts({ tempCoeff: "-0,4" }))?.tempCoefficient).toBeCloseTo(
      -0.4,
      10,
    );
  });

  test("rejects a field that was filled in but cannot be read", () => {
    for (const bad of [{ tempCoeff: "" }, { loss: "abc" }, { battCharge: "five" }]) {
      expect(parseInverterFields(texts(bad))).toBeNull();
    }
  });

  test("rejects an array with any incomplete corner, rather than dropping it", () => {
    expect(
      parseInverterFields(texts({ arrays: [{ kwp: "9.8", tilt: "", azimuth: "0" }] })),
    ).toBeNull();
  });

  test("accepts an inverter with no arrays at all", () => {
    expect(parseInverterFields(texts({ arrays: [] }))?.arrays).toEqual([]);
  });

  test("omits the battery entirely when no capacity is stated", () => {
    const parsed = parseInverterFields(
      texts({ battUsable: "", battReserve: "20", battCharge: "5" }),
    );
    expect(parsed?.battery).toBeNull();
  });

  test("defaults the reserve when it is left blank, but not the capacity", () => {
    expect(parseInverterFields(texts({ battReserve: "" }))?.battery?.minSoc).toBe(
      DEFAULT_RESERVE_PCT,
    );
    expect(parseInverterFields(texts({ battUsable: "nope" }))).toBeNull();
  });

  test("keeps a battery with no charge limit — that field is optional", () => {
    expect(parseInverterFields(texts({ battCharge: "" }))?.battery).toEqual({
      usableKwh: 15,
      maxChargeW: null,
      minSoc: 10,
      nominalV: 51.2,
    });
  });
});

describe("the battery's nominal voltage", () => {
  test("is kept as entered, and stays null when blank — which is not 51.2", () => {
    expect(parseInverterFields(texts({ battNominalV: "48" }))?.battery?.nominalV).toBe(48);
    expect(parseInverterFields(texts({ battNominalV: "" }))?.battery?.nominalV).toBeNull();
  });

  test("rejects a voltage that was typed but cannot be read", () => {
    expect(parseInverterFields(texts({ battNominalV: "fifty" }))).toBeNull();
  });

  test("is absent along with the rest of the block when no battery is stated", () => {
    expect(parseInverterFields(texts({ battUsable: "", battNominalV: "48" }))?.battery).toBeNull();
  });
});

describe("inverterTextsFrom", () => {
  const stored = (over: Partial<StoredInverter> = {}): StoredInverter => ({
    arrays: [{ kwp: 9.8, tilt: 30, azimuth: -15 }],
    tempCoefficient: -0.4,
    systemLoss: 14,
    battery: { usableKwh: 15, maxChargeW: 5_000, minSoc: 10, nominalV: null },
    ...over,
  });

  test("shows the charge power in kW and blanks the whole battery group when there is none", () => {
    expect(inverterTextsFrom(stored()).battCharge).toBe("5");
    const none = inverterTextsFrom(stored({ battery: null }));
    expect([none.battUsable, none.battCharge, none.battReserve, none.battNominalV]).toEqual([
      "",
      "",
      "",
      "",
    ]);
  });

  test("round-trips through the parser unchanged", () => {
    const original = stored();
    expect(parseInverterFields(inverterTextsFrom(original))).toEqual(original);
  });

  test("the defaults are the column defaults, parsed", () => {
    expect(parseInverterFields(DEFAULT_INVERTER_TEXTS)).toEqual({
      arrays: [],
      tempCoefficient: -0.4,
      systemLoss: 14,
      battery: null,
    });
  });
});

describe("per-array overrides the section does not edit", () => {
  const withOverrides = (): StoredInverter => ({
    arrays: [
      {
        kwp: 5,
        tilt: 20,
        azimuth: -90,
        deviceSlug: "east-inv",
        systemLoss: 25,
      },
      { kwp: 9.8, tilt: 30, azimuth: 0, tempCoefficient: -0.29 },
    ],
    tempCoefficient: -0.4,
    systemLoss: 14,
    battery: null,
  });

  test("survive a save round-trip untouched, even when the geometry is edited", () => {
    const original = withOverrides();
    expect(parseInverterFields(inverterTextsFrom(original))?.arrays).toEqual(original.arrays);
    const edited = inverterTextsFrom(original);
    edited.arrays[0]!.tilt = "35";
    expect(parseInverterFields(edited)?.arrays[0]).toEqual({
      kwp: 5,
      tilt: 35,
      azimuth: -90,
      deviceSlug: "east-inv",
      systemLoss: 25,
    });
  });

  test("do not appear on an array that never had them — no key, not undefined", () => {
    const parsed = parseInverterFields(inverterTextsFrom(withOverrides()));
    expect(Object.keys(parsed?.arrays[1] ?? {}).sort()).toEqual([
      "azimuth",
      "kwp",
      "tempCoefficient",
      "tilt",
    ]);
    const plain = parseInverterFields(texts({ arrays: [{ kwp: "1", tilt: "1", azimuth: "1" }] }));
    expect(Object.keys(plain?.arrays[0] ?? {}).sort()).toEqual(["azimuth", "kwp", "tilt"]);
  });

  test("are dropped along with the array when its geometry is unparseable", () => {
    const edited = inverterTextsFrom(withOverrides());
    edited.arrays[0]!.tilt = "";
    expect(parseInverterFields(edited)).toBeNull();
  });
});
