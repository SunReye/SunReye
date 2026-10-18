import { flushSync } from "svelte";
import { expect, test } from "vitest";
import { plantCeiling } from "./plant-ceiling.svelte";

// The power-flow diagram folds every sample into the ceiling from inside an
// `$effect`. If `observe()` READ the state it then writes, that effect would
// depend on its own write and Svelte would take the diagram down at mount with
// `effect_update_depth_exceeded` — no rails, no comets. Runes run here, so this
// runs the fold the way the diagram does instead of reading the class's source.

test("folding a sample from inside an effect neither loops nor goes stale", () => {
  const sample = $state({ watts: 0 });
  const errors: unknown[] = [];
  let runs = 0;

  const stop = $effect.root(() => {
    $effect(() => {
      runs++;
      try {
        plantCeiling.observe(sample.watts);
      } catch (error) {
        errors.push(error);
      }
    });
  });

  try {
    flushSync();
    sample.watts = 50_000;
    flushSync();

    expect(errors).toEqual([]);
    // Once at mount, once per sample — not once per write it made.
    expect(runs).toBe(2);
    // …and the diagram still sees the plant grow: the published ceiling is live.
    expect(plantCeiling.watts).toBe(50_000);
  } finally {
    stop();
  }
});

test("what the diagram reads is reactive", () => {
  const seen: number[] = [];
  const stop = $effect.root(() => {
    $effect(() => {
      seen.push(plantCeiling.watts);
    });
  });

  try {
    flushSync();
    plantCeiling.observe(80_000);
    flushSync();
    expect(seen.at(-1)).toBe(80_000);
    expect(seen).toHaveLength(2);
  } finally {
    stop();
  }
});
