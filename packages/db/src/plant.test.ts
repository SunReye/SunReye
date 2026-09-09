import { describe, expect, test } from "bun:test";
import { plantConfigSchema, plantPatchFrom, resolveServerZone } from "./plant";
import { TIME_ZONE_AUTO } from "./time-zone";

describe("plantConfigSchema", () => {
  test("defaults the plant zone to the auto sentinel", () => {
    expect(plantConfigSchema.parse({})).toEqual({ timeZone: TIME_ZONE_AUTO });
  });

  test("accepts a valid IANA zone and rejects an unknown one", () => {
    expect(plantConfigSchema.parse({ timeZone: "Europe/Berlin" })).toEqual({
      timeZone: "Europe/Berlin",
    });
    expect(() => plantConfigSchema.parse({ timeZone: "Not/AZone" })).toThrow();
  });
});

describe("resolveServerZone", () => {
  test("an explicit plant zone wins over the display zone and the host", () => {
    expect(resolveServerZone("Europe/Berlin", "America/New_York", "UTC")).toBe("Europe/Berlin");
    expect(resolveServerZone("Europe/Berlin", "auto", "UTC")).toBe("Europe/Berlin");
  });

  test("falls back to an explicit display zone when the plant zone is auto (legacy inheritance)", () => {
    // Instances that set Display → time zone to fix #46/#52 keep working with no
    // migration, until a plant zone is set explicitly.
    expect(resolveServerZone("auto", "Europe/Berlin", "UTC")).toBe("Europe/Berlin");
    expect(resolveServerZone(TIME_ZONE_AUTO, "Europe/Berlin", "UTC")).toBe("Europe/Berlin");
  });

  test("falls back to the host zone when both plant and display are auto", () => {
    expect(resolveServerZone("auto", "auto", "UTC")).toBe("UTC");
    expect(resolveServerZone("auto", "auto", "Europe/Berlin")).toBe("Europe/Berlin");
  });
});

describe("the plant's editable name", () => {
  test("is optional, so a form that only sends a zone does not touch it", () => {
    // The named-write discipline the columns exist for: absent means "leave it
    // alone". The display form sends the zone alone and must not blank the name.
    expect(plantConfigSchema.parse({ timeZone: "auto" }).name).toBeUndefined();
    expect(plantPatchFrom({ timeZone: "auto" })).toEqual({ timeZone: "auto" });
  });

  test("is carried into the patch when it IS sent", () => {
    expect(plantPatchFrom({ timeZone: "auto", name: "Haus Müller" })).toEqual({
      timeZone: "auto",
      name: "Haus Müller",
    });
  });

  test("a blank name is refused rather than stored", () => {
    // The name is what every surface labels the plant with; "" would render an
    // empty heading, and the slug (which is frozen) cannot stand in for it.
    expect(() => plantConfigSchema.parse({ timeZone: "auto", name: "" })).toThrow();
    expect(() => plantConfigSchema.parse({ timeZone: "auto", name: " ".repeat(3) })).toThrow();
  });

  test("the patch can never name a SLUG", () => {
    // The slug becomes the MQTT namespace and Home Assistant keys entities on
    // `unique_id`, so it is frozen at onboarding. Renaming must stay a name-only
    // operation, and this is the type-level half of that guarantee.
    const patch = plantPatchFrom({ timeZone: "auto", name: "Renamed" });
    expect(Object.keys(patch).sort()).toEqual(["name", "timeZone"]);
    expect(patch).not.toHaveProperty("slug");
  });
});
