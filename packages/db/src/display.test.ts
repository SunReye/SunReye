import { describe, expect, test } from "bun:test";
import { defaultDisplay, displayConfigSchema, resolvePlantTimeZone } from "./display";

describe("resolvePlantTimeZone", () => {
  test("an explicit IANA zone drives bucketing, overriding the host zone", () => {
    const config = displayConfigSchema.parse({ timeZone: "Europe/Berlin" });
    // Host zone is offered as the fallback but must be ignored when set explicitly.
    expect(resolvePlantTimeZone(config, "UTC")).toBe("Europe/Berlin");
    expect(resolvePlantTimeZone(config, "America/New_York")).toBe("Europe/Berlin");
  });

  test('"auto" falls back to the supplied host zone (back-compatible default)', () => {
    expect(resolvePlantTimeZone(defaultDisplay, "UTC")).toBe("UTC");
    expect(resolvePlantTimeZone(defaultDisplay, "Europe/Berlin")).toBe("Europe/Berlin");
  });
});
