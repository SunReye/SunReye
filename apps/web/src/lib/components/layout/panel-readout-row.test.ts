/**
 * The readout row's three load-bearing conventions, in the established
 * source-text style (`header-and-toolbar-rows.test.ts` documents the trade-off:
 * runes do not run under `bun test` and there is no render harness here). This
 * is NOT the proof that the row lands its value left and its controls right at
 * every width — `e2e/` measures the `data-slot`s for that. What it pins is what
 * a rename or a well-meaning inline class would quietly undo.
 */

import { describe, expect, test } from "bun:test";
import { readoutRowClass } from "../../layout/tokens";

const source = await Bun.file(new URL("panel-readout-row.svelte", import.meta.url)).text();

/** The template, i.e. everything after the closing `</script>`. */
const template = source.slice(source.lastIndexOf("</script>"));

describe("the readout row", () => {
  test("spends nothing on a card that has neither a value nor controls", () => {
    // The regression this names: most cards pass neither snippet, and an
    // unguarded row is still a grid item — it takes the body's row gap above
    // the plot on every one of them.
    const guard = template.match(/\{#if[^}]*\}/);
    expect(guard, "the row renders unconditionally").not.toBeNull();
    expect(template.indexOf(guard![0])).toBeLessThan(
      template.indexOf('data-slot="panel-readout-row"'),
    );
    // The condition itself is a `$derived` in the script rather than an
    // expression in the template — the template is the one thing here that
    // cannot be unit-tested, so it holds no logic it does not have to. What must
    // be true is that BOTH snippets are what the derived reads: guarding on one
    // of them would drop the row for every card that passes only the other.
    const filled = source.match(/const filled = \$derived\(([^\n]*)\);/);
    expect(filled, "the guard is no longer a named derived").not.toBeNull();
    expect(filled![1]).toContain("value");
    expect(filled![1]).toContain("controls");
  });

  test("takes its layout from the token and adds nothing of its own", () => {
    // A hand-rolled class at this call site is how the placement bug this row
    // replaces got in: `justify-center` on a wrapped line. The root's class is
    // the token expression and nothing else.
    expect(template).toContain(`data-slot="panel-readout-row" class={readoutRowClass()}`);
    expect(readoutRowClass()).not.toContain("justify-");
  });

  test("names the cells the browser spec measures", () => {
    for (const slot of ["panel-readout-row", "panel-readout-value", "panel-readout-controls"]) {
      expect(template, `${slot} is what e2e queries`).toContain(`data-slot="${slot}"`);
    }
  });

  test("lets a long value shrink instead of pushing the controls away", () => {
    // A grid item's automatic minimum is its min-content size, so a long
    // formatted number plus a delta chip would widen the `1fr` track and shove
    // the controls off the right edge without `min-w-0`.
    const valueCell = template.match(/<div data-slot="panel-readout-value"[^>]*>/)![0];
    expect(valueCell).toContain("min-w-0");
  });
});
