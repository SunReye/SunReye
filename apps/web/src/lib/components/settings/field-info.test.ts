import { describe, expect, test } from "bun:test";

/**
 * Settings fields explain themselves through the same ⓘ popover the statistics
 * tiles use, not through a paragraph of prose under every input.
 *
 * A settings form is a list of decisions. A sentence under each one buries the
 * decisions themselves — the reader scrolls past explanation hunting for the
 * box. The text is unchanged and one tap away; it just stops competing with the
 * field it describes.
 *
 * A source-text test, the weaker layer (apps/web/TESTING.md): it pins the
 * affordance each form reaches for, which is the thing that would drift back.
 */
const read = async (file: string) => await Bun.file(new URL(file, import.meta.url).pathname).text();

const fieldInfo = await read("./field-info.svelte");
const forms = Object.fromEntries(
  await Promise.all(
    // The roof and pack fields moved onto the device dialog (2026-09-04); the
    // rule follows them there.
    ["pv-fields", "battery-fields", "plant-site-fields", "export-cap-helper", "weather-form"].map(
      async (f) => [f, await read(`./${f}.svelte`)] as const,
    ),
  ),
);

describe("the settings field info affordance", () => {
  test("is the same popover the statistics tiles use", () => {
    expect(fieldInfo).toContain("Popover.Root");
    expect(fieldInfo).toContain("phosphor-svelte/lib/Info");
  });

  test("spends TAP, or the icon is a 14px target", () => {
    // The mobile floor is 44px for anything tappable, and an ⓘ at size-3.5 is
    // nowhere near it without the expanded hit area.
    expect(fieldInfo).toContain("TAP");
  });

  test("is labelled for a screen reader, since the trigger is icon-only", () => {
    expect(fieldInfo).toContain("aria-label");
    expect(fieldInfo).toContain("settings_field_info_aria");
  });

  test("renders only the trigger, so a call site keeps its own label", () => {
    // Replacing each label's markup would have meant touching every form's
    // layout to add one icon.
    expect(fieldInfo).not.toContain("<Label");
  });
});

describe("the plant, inverter and weather forms", () => {
  test.each(Object.keys(forms))("%s explains its fields through the popover", (name) => {
    expect(forms[name]).toContain("FieldInfo");
  });

  test("no longer describe a field in prose beneath it", () => {
    // `text-xs text-muted-foreground` under an input was the old pattern. What
    // may still be prose is an EMPTY state or a loading line — neither describes
    // a field, and neither has a label to hang an icon on.
    for (const [name, source] of Object.entries(forms)) {
      const prose = [...source.matchAll(/text-(?:xs|sm) text-muted-foreground">\{([^}]+)\}/g)].map(
        (mm) => mm[1]?.trim(),
      );
      for (const message of prose) {
        expect(message).toMatch(/empty|loading|plant_hint|helper/);
        expect(`${name}: ${message}`).not.toContain("_desc(");
      }
    }
  });
});
