import { describe, expect, test } from "bun:test";

/**
 * Where the plant's own description is edited, and — more importantly — who is
 * allowed to WRITE it.
 *
 * The PV surfaces, the export limit, the battery and the smart-meter date share
 * one stored record with the weather settings, because the solar forecast was
 * the first thing to read them. It is no longer the only one: the export limit
 * and the battery drive peak shaving, and the smart-meter date decides whether
 * §51 applies at all. So they are edited with the inverter, and the weather form
 * must send only its own half — if it sent the whole record, saving a location
 * would write back whatever arrays that page had loaded, silently undoing the
 * other page.
 *
 * A source-text test, which is the weaker layer (apps/web/TESTING.md): it pins
 * the fields a form names in its request, which is the thing that actually
 * causes the clobber, rather than that some string appears somewhere.
 */
const read = async (file: string) => await Bun.file(new URL(file, import.meta.url).pathname).text();

const weatherForm = await read("./weather-form.svelte");
const plantForm = await read("./plant-form.svelte");
const blockerAlert = await read("../automations/blocker-alert.svelte");
const peakShavingForm = await read("../automations/peak-shaving-form.svelte");

/** The body of the single `settings.weather.put({...})` call in a form. */
function putBody(source: string): string {
  const start = source.indexOf("settings.weather.put(");
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("});", start));
}

/** Fields that describe the plant, not the weather. */
const PLANT_FIELDS = [
  "arrays",
  "tempCoefficient",
  "systemLoss",
  "maxOutputW",
  "houseLoadW",
  "battery",
  "smartMeterSince",
];

describe("the plant's own fields", () => {
  test("are edited on the plant form", () => {
    expect(plantForm).toContain("SolarForecastFields");
    for (const field of PLANT_FIELDS) expect(putBody(plantForm)).toContain(field);
  });

  test("are not rendered by the weather form any more", () => {
    expect(weatherForm).not.toContain("SolarForecastFields");
  });

  test("are never written by the weather form — that is the clobber", () => {
    // The weather form owns location, the forecast switch, its provider and the
    // correction switch. Naming anything else here means a location save can
    // overwrite the plant.
    const body = putBody(weatherForm);
    for (const field of PLANT_FIELDS) expect(body).not.toContain(field);
    for (const own of ["latitude", "longitude", "label", "provider", "correction"]) {
      expect(body).toContain(own);
    }
  });

  test("a config blocker sends the reader to the inverter, not to the weather page", () => {
    // Every config blocker names a plant fact (export limit, battery,
    // smart-meter date). Pointing at the weather page was the symptom that
    // started this: an automation asking for a regulatory date under "Weather".
    expect(blockerAlert).toContain("resolve('/settings/inverter')");
    expect(blockerAlert).not.toContain("resolve('/settings/weather')");
  });

  test("the battery's nominal voltage is edited here, not on the automations page", () => {
    // It describes the battery, so it moved with the rest of the pack's
    // description. The automation still READS the legacy value (an install that
    // set 48 V must keep charging at 48 V), but two editors for one number is
    // how the two drift apart.
    expect(putBody(plantForm)).toContain("battery");
    expect(plantForm).toContain("battNominalV");
    expect(peakShavingForm).not.toContain("nominalBatteryV");
  });
});
