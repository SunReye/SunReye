import { describe, expect, test } from "bun:test";

import { fieldLabel } from "./field-label";

describe("what a catalog field is called on screen", () => {
  test("a field this build knows is named in prose, not by its key", () => {
    expect(fieldLabel("topicRoot")).toBe("Topic root");
    expect(fieldLabel("haDiscoveryEnabled")).toBe("Announce Home Assistant discovery");
  });

  // A field name arrives from the SERVER's catalog, so a build can meet one it
  // has no translation for — a newer server, or an integration added after this
  // web build shipped. The raw name is a worse label than a sentence and a much
  // better one than an empty row, so it is what comes back.
  test("a field this build has never heard of falls back to its own name", () => {
    expect(fieldLabel("somethingNew")).toBe("somethingNew");
    expect(fieldLabel("")).toBe("");
  });

  // A field named like a property of Object would resolve to a function against
  // a plain object index, and the label would render as source code.
  test("a field named after an inherited property is not one this build knows", () => {
    expect(fieldLabel("constructor")).toBe("constructor");
    expect(fieldLabel("toString")).toBe("toString");
  });
});
