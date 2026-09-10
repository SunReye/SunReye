import { describe, expect, test } from "bun:test";

import { type RenameState, renameBlock } from "./rename-logic";

const state = (over: Partial<RenameState> = {}): RenameState => ({
  typed: "Carport West",
  current: "Carport",
  submitting: false,
  ...over,
});

describe("whether a rename may be submitted", () => {
  test("a changed, valid name is submittable", () => {
    expect(renameBlock(state())).toBeNull();
  });

  test("no row open blocks before anything else is judged", () => {
    expect(renameBlock(state({ current: null, typed: "" }))).toBe("no-row");
  });

  test("a request in flight blocks a second one", () => {
    expect(renameBlock(state({ submitting: true }))).toBe("submitting");
  });

  test("empty, and whitespace-only, are the same emptiness", () => {
    expect(renameBlock(state({ typed: "" }))).toBe("empty");
    expect(renameBlock(state({ typed: "   " }))).toBe("empty");
  });

  test("a name with no letter or digit is refused before the request", () => {
    expect(renameBlock(state({ typed: "---" }))).toBe("invalid");
    expect(renameBlock(state({ typed: "x".repeat(200) }))).toBe("invalid");
  });

  // Not an error — a no-op. The server answers `nothing to change` with a 400,
  // and an operator who reopened the dialog and closed it should see neither.
  test("the row's own name is a no-op, and the trim decides that", () => {
    expect(renameBlock(state({ typed: "Carport" }))).toBe("unchanged");
    expect(renameBlock(state({ typed: "  Carport  " }))).toBe("unchanged");
    expect(renameBlock(state({ typed: "carport" }))).toBeNull();
  });
});
