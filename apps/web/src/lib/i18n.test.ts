import { describe, expect, it } from "bun:test";
import { localeName } from "./i18n";

describe("localeName", () => {
  it("names a language in its own tongue, whatever the UI locale", () => {
    expect(localeName("de")).toBe("Deutsch");
    expect(localeName("fr")).toBe("français");
  });

  it("falls back to the code for a tag Intl rejects", () => {
    expect(localeName("not a locale!")).toBe("not a locale!");
  });
});
