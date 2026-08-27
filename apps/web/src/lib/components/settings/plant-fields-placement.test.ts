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
 *
 * ## Why this file SURVIVED the 2.0.0 move to real columns
 *
 * 2.0.0 gave every plant fact its own column on `plants`, and
 * `apps/server/src/settings/weather-settings.ts` now emits an `UPDATE` naming
 * only the fields the incoming patch mentioned
 * (`packages/db/src/plant-facts.ts`, `splitWeatherWrite`). That kills the
 * IMPLICIT clobber completely, and it was the whole bug: a JSONB save is a
 * read-modify-write of the entire document, so a form had no way to send its own
 * half — it wrote back everything it had loaded whether it meant to or not. That
 * mechanism is gone, and no rule about forms is needed to keep it gone.
 *
 * What is NOT gone is the EXPLICIT clobber: a form that names `arrays` in its
 * request still writes the value it happens to be holding. The consequence is
 * milder now (one form saving a field it displays, rather than an unrelated
 * page's edit vanishing) but the fix is still the same rule — a form names only
 * what it owns — and nothing in the type system says so. So the assertions stay,
 * and the strong new guarantee is tested where it actually lives, in
 * `packages/db/src/plant-facts.test.ts` ("writes ONLY the columns the patch
 * named").
 *
 * The last two tests were never about the clobber at all: they pin where a
 * config blocker sends the reader, and that the pack voltage has ONE editor.
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
