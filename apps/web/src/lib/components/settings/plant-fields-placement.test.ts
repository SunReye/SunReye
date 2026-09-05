import { describe, expect, test } from "bun:test";

/**
 * Who is allowed to WRITE each half of the plant's description.
 *
 * Three forms edit one stored weather record plus the device rows. The weather
 * form owns the location and the forecast switches; the plant form owns the
 * site facts (export limit, house load, smart-meter date); the device dialog
 * owns the INVERTER'S facts — its PV arrays, panel physics and pack. The server
 * enforces the last boundary (a weather patch naming an inverter fact is a 400,
 * `packages/db/src/plant-facts.ts` `movedToDevice`), but nothing in the type
 * system stops a form from naming a field it does not own, and a form that does
 * writes whatever value it happens to be holding.
 *
 * A source-text test, which is the weaker layer (apps/web/TESTING.md): it pins
 * the fields a form names in its request — the thing that actually causes the
 * clobber — rather than that some string appears somewhere.
 */
const read = async (file: string) => await Bun.file(new URL(file, import.meta.url).pathname).text();

const weatherForm = await read("./weather-form.svelte");
const plantForm = await read("./plant-form.svelte");
const deviceLogic = await read("./devices/add-device-logic.ts");
const blockerAlert = await read("../automations/blocker-alert.svelte");
const peakShavingForm = await read("../automations/peak-shaving-form.svelte");

/** The body of the single `settings.weather.put({...})` call in a form. */
function putBody(source: string): string {
  const start = source.indexOf("settings.weather.put(");
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("});", start));
}

/** Site facts: the plant's own. */
const SITE_FIELDS = ["maxOutputW", "houseLoadW", "smartMeterSince"];
/** Inverter facts: the device's own, refused by the weather PUT. */
const INVERTER_FIELDS = ["arrays", "tempCoefficient", "systemLoss", "battery"];

describe("the plant's site fields", () => {
  test("are edited on the plant form, and only they are", () => {
    expect(plantForm).toContain("PlantSiteFields");
    const body = putBody(plantForm);
    for (const field of SITE_FIELDS) expect(body).toContain(field);
    for (const field of INVERTER_FIELDS) expect(body).not.toContain(field);
  });

  test("are never written by the weather form — that is the clobber", () => {
    const body = putBody(weatherForm);
    for (const field of [...SITE_FIELDS, ...INVERTER_FIELDS]) expect(body).not.toContain(field);
    for (const own of ["latitude", "longitude", "label", "provider", "correction"]) {
      expect(body).toContain(own);
    }
  });
});

describe("the inverter's fields", () => {
  test("are sent by the device dialog's body builders and by nothing that PUTs the weather record", () => {
    // `buildAddDeviceBody` spreads the parsed section; `devicePatch` names each
    // field it diffs. Both live in the logic module, which is what the dialog
    // sends — so this is the one place the inverter's facts leave the browser.
    for (const field of INVERTER_FIELDS) expect(deviceLogic).toContain(field);
    expect(deviceLogic).toContain("parseInverterFields");
    expect(plantForm).not.toContain("InverterSection");
    expect(weatherForm).not.toContain("InverterSection");
  });

  test("the battery's nominal voltage is edited with the pack, not on the automations page", () => {
    // Two editors for one number is how the two drift apart. The automation
    // still READS the legacy value (an install that set 48 V must keep charging
    // at 48 V) — through provisioning, which moved it onto the pack row once.
    expect(peakShavingForm).not.toContain("nominalBatteryV");
    expect(plantForm).not.toContain("battNominalV");
  });

  test("a config blocker sends the reader to the devices, not to the weather page", () => {
    // Every config blocker names an inverter or site fact (export limit, battery,
    // smart-meter date), and both are reached from Settings → Devices.
    expect(blockerAlert).toContain("resolve('/settings/devices')");
    expect(blockerAlert).not.toContain("resolve('/settings/weather')");
    expect(blockerAlert).not.toContain("resolve('/settings/inverter')");
  });
});
