/**
 * The range switcher's one decision that is not markup: what a selection
 * change means when the group reports NOTHING selected.
 *
 * The segmented row is a `ToggleGroup type="single"`, and a toggle group lets
 * the reader press the active item again to deselect it — reporting `""`. A
 * range switcher with no range picked has no meaning: the chart beside it would
 * have nothing to draw. So the empty report is swallowed and the current value
 * stands.
 */

import { describe, expect, it } from "bun:test";
import { commitRangeSelection } from "./range-switcher";

/** The option ids of a two-option switcher, so the generic is not narrowed to
 * the current value alone by inference. */
type Range = "day" | "week";

describe("committing a segmented selection", () => {
  it("takes a newly pressed option", () => {
    expect(commitRangeSelection<Range>("week", "day")).toBe("week");
  });

  it("keeps the current option when the group reports nothing selected", () => {
    // Re-pressing the active item in a ToggleGroup deselects it; the switcher
    // must not end up with no selection.
    expect(commitRangeSelection<Range>("", "day")).toBe("day");
  });

  it("keeps the current option when the group reports undefined", () => {
    expect(commitRangeSelection<Range>(undefined, "day")).toBe("day");
  });

  it("is a no-op when the pressed option is already the current one", () => {
    expect(commitRangeSelection<Range>("day", "day")).toBe("day");
  });

  it("ignores a multi-select array, which this switcher never uses", () => {
    // `type="single"` is what makes the value a string; if a caller ever flips
    // that, the switcher keeps its value rather than binding an array into a
    // `T extends string`.
    expect(commitRangeSelection<Range>(["week"] as unknown as string, "day")).toBe("day");
  });
});
