/**
 * The rune shell around the plant ceiling — and the one thing about it that is
 * not a matter of taste.
 *
 * `plantCeiling.observe()` is called from the diagram's `$effect`. If that call
 * READS a `$state` field which it then writes, the effect depends on what it is
 * about to change: Svelte marks the source dirty (a fresh `Ceiling` object is
 * never `===` the last one), reschedules the effect, and the whole diagram dies
 * at mount with `effect_update_depth_exceeded` — no comets, no rails, nothing.
 * Quantizing does not save it, and neither does `untrack`: `$state` on an object
 * hands back a DEEP PROXY, so `decayCeiling(prev, …)` reading `prev.watts` off
 * it registers the dependency again one property deeper.
 *
 * So the fold's memory is a plain field and only a primitive is published. That
 * is a claim about reactivity plumbing, which runes-do-not-run-under-bun-test
 * (apps/web/TESTING.md) puts out of reach of an executed assertion — so it is
 * pinned by reading the source, in the style of the wiring tests next door.
 * Every case here parses the class rather than searching the file for a string.
 */

import { describe, expect, test } from "bun:test";
import { CEILING_FLOOR_W, decayCeiling } from "./flow-pulse";

const shell = await Bun.file(new URL("./plant-ceiling.svelte.ts", import.meta.url)).text();

/** The braces block that starts at `open`, braces included. */
function block(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    depth += Number(code[i] === "{") - Number(code[i] === "}");
    if (depth === 0) return code.slice(open, i + 1);
  }
  throw new Error("unterminated block");
}

/** The body of the class declaration, braces included. */
function classBody(code: string): string {
  const at = code.indexOf("class PlantCeiling");
  if (at < 0) throw new Error("no PlantCeiling class");
  return block(code, code.indexOf("{", at));
}

/** The body of a method or getter, found by the text that opens it. */
function memberBody(code: string, opener: string): string {
  const at = code.indexOf(opener);
  if (at < 0) throw new Error(`no member matching ${opener}`);
  return block(code, code.indexOf("{", at));
}

/** `code` without its comments: a mention in prose is not a read. */
const withoutComments = (code: string): string =>
  code.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/[^\n]*/g, "");

/** Every private field the class declares, mapped to its initialiser. */
function fields(body: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of withoutComments(body).matchAll(/^\s*(#\w+)(?::[^=\n]+)?\s*=\s*(.+)$/gm))
    found.set(m[1], m[2].trim());
  return found;
}

/** The fields whose initialiser is a rune — the ones a read of makes a
 *  dependency. `$state.raw` counts: the source itself is still tracked. */
const reactiveFields = (body: string): string[] =>
  [...fields(body)].filter(([, init]) => init.startsWith("$state")).map(([name]) => name);

/** Every `this.#x` in `code` that is not the target of a plain assignment. */
function readsOf(code: string, field: string): number {
  const bare = withoutComments(code);
  const uses = [...bare.matchAll(new RegExp(`this\\.${field}\\b`, "g"))];
  return uses.filter((u) => !/^\s*=[^=]/.test(bare.slice(u.index + u[0].length))).length;
}

const body = classBody(shell);
const observe = memberBody(body, "observe(");

describe("the fold cannot invalidate the effect that runs it", () => {
  test("observe never reads a rune-backed field", () => {
    // THE bug this file exists for. `decayCeiling(this.#ceiling, …)` inside the
    // diagram's `$effect` makes that effect depend on the very state the next
    // line writes, and Svelte's infinite-loop guard takes the diagram down with
    // `effect_update_depth_exceeded` before a single comet is painted.
    const reactive = reactiveFields(body);
    expect(reactive).not.toEqual([]);
    for (const field of reactive) expect([field, readsOf(observe, field)]).toEqual([field, 0]);
  });

  test("the memory it folds is a plain field, so property reads are not tracked", () => {
    // Not `untrack`, and not `$state.raw` either: what `decayCeiling` is handed
    // has to be an ordinary object, because a `$state` object is a deep proxy
    // and reading `.watts` off it re-registers the dependency one level down.
    const memory = /decayCeiling\(\s*this\.(#\w+)/.exec(withoutComments(observe))?.[1] ?? "";
    expect(memory).not.toBe("");
    expect(reactiveFields(body)).not.toContain(memory);
    expect(fields(body).get(memory)).toContain("parseCeiling(");
  });

  test("but what the diagram reads is still reactive, and is a number", () => {
    // The cheap way to silence the loop is to drop the rune altogether — and
    // then the ceiling never updates and every rail is drawn against the floor
    // forever. A primitive also means an unchanged sample writes nothing at all.
    const watts = memberBody(body, "get watts(");
    const published = /return this\.(#\w+)\s*;/.exec(withoutComments(watts))?.[1] ?? "";
    expect(published).not.toBe("");
    expect(reactiveFields(body)).toContain(published);
    expect(fields(body).get(published)).toMatch(/^\$state\(/);
    expect(readsOf(observe, published)).toBe(0);
  });
});

describe("the ceiling still survives a reload", () => {
  test("the seed is the parsed store, at the floor when there is nothing to parse", () => {
    // Read before the first paint: a half-written entry must not take the
    // diagram down, which is why the parsing lives in `flow-pulse.ts`.
    const memory = /decayCeiling\(\s*this\.(#\w+)/.exec(withoutComments(observe))?.[1] ?? "";
    expect(fields(body).get(memory)).toBe("parseCeiling(read());");
  });

  test("a fold that changes nothing publishes nothing", () => {
    // The value-level half of the loop guard, and it is testable: two folds at
    // the same instant agree, so the published number is unchanged and Svelte's
    // `===` check makes the second write a no-op.
    const prev = { watts: 9000, at: 1_000_000 };
    const once = decayCeiling(prev, 1_000_500, 300);
    expect(decayCeiling(once, 1_000_500, 300).watts).toBe(once.watts);
    expect(decayCeiling(prev, 1_000_500, 300)).toEqual(once);
    expect(once.watts).toBeGreaterThanOrEqual(CEILING_FLOOR_W);
  });
});
