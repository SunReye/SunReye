/**
 * That the rails really shoot the pulses `lib/inverter/flow-pulse.ts` computes,
 * and that nothing a reading can reach is a timing property.
 *
 * The old rails mapped watts onto `animation-duration` (`flowDuration`), and
 * changing a duration mid-flight remaps the elapsed time: every dot on the rail
 * jumps at every 1 Hz sample. The rewrite moves the whole signal onto opacity,
 * dash head length, stroke width and bloom, all of which can change without a
 * positional discontinuity. That is a claim about WHICH CSS properties see a
 * datum, so it is pinned here rather than left to a screenshot.
 *
 * Runes do not execute under `bun test` and there is no render harness
 * (apps/web/TESTING.md), so these cases read the sources — in the style of
 * lib/charts/zoom-wiring.test.ts. Every case pins structure or captures the
 * identifier that is really passed: "the file mentions railPulse somewhere"
 * stays green while the rails are handed a stale object.
 */

import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { PULSE_PERIOD_S } from "../../inverter/flow-pulse";

const SRC = new URL("../../../", import.meta.url);

const read = async (file: string): Promise<string> => await Bun.file(new URL(file, SRC)).text();

const RAILS = "lib/components/inverter/_shared/power-flow-rails.svelte";
const DIAGRAM = "lib/components/inverter/power-flow-diagram.svelte";
const NODE = "lib/components/inverter/power-flow-node.svelte";
const SIGNAL = "lib/inverter/flow-pulse.ts";

const rails = await read(RAILS);
const diagram = await read(DIAGRAM);
const node = await read(NODE);
const signal = await read(SIGNAL);

const OPEN = new Set(["(", "[", "{"]);
const CLOSE = new Set([")", "]", "}"]);

/** The braces block that starts at `open`, braces included. */
function block(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    depth += Number(code[i] === "{") - Number(code[i] === "}");
    if (depth === 0) return code.slice(open, i + 1);
  }
  throw new Error("unterminated block");
}

/** The text inside the balanced parens that open at `open`. */
function callAt(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    depth += Number(OPEN.has(code[i])) - Number(CLOSE.has(code[i]));
    if (depth === 0) return code.slice(open + 1, i);
  }
  throw new Error("unbalanced call");
}

/** The text between the balanced parens of the first `name(` call. */
function callArguments(code: string, name: string): string {
  const at = code.indexOf(`${name}(`);
  if (at < 0) throw new Error(`no call to ${name}`);
  return callAt(code, at + name.length);
}

/** `text` split at the commas that are not nested inside anything. */
function topLevelParts(text: string): string[] {
  const parts: string[] = [""];
  let depth = 0;
  for (const ch of text) {
    depth += Number(OPEN.has(ch)) - Number(CLOSE.has(ch));
    if (ch === "," && depth === 0) parts.push("");
    else parts[parts.length - 1] += ch;
  }
  return parts.map((s) => s.trim()).filter((s) => s !== "");
}

const argumentsOf = (code: string, name: string): string[] =>
  topLevelParts(callArguments(code, name));

/** The whole of a `const name = …` declaration — to the `;` that ends it, not
 *  to the first one inside its body. */
function declaration(code: string, name: string): string {
  const at = code.indexOf(`const ${name} =`);
  if (at < 0) throw new Error(`no declaration of ${name}`);
  const rest = code.slice(at);
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    depth += Number(OPEN.has(rest[i])) - Number(CLOSE.has(rest[i]));
    if (depth === 0 && rest[i] === ";") return rest.slice(0, i);
  }
  return rest;
}

/** `code` without its line comments: a comma inside one separates nothing. */
const withoutComments = (code: string): string => code.replaceAll(/\/\/[^\n]*/g, "");

/** The value an object literal gives `key`, shorthand resolved to the key. */
function objectProperty(literal: string, key: string): string {
  for (const part of topLevelParts(withoutComments(literal).slice(1, -1))) {
    const colon = part.indexOf(":");
    const name = (colon < 0 ? part : part.slice(0, colon)).trim();
    if (name !== key) continue;
    return colon < 0 ? name : part.slice(colon + 1).trim();
  }
  throw new Error(`no ${key} in ${literal}`);
}

/** The `<style>` contents of a component. */
function css(code: string): string {
  const at = code.indexOf("<style>");
  if (at < 0) throw new Error("this component has no style block");
  return code.slice(at + "<style>".length, code.indexOf("</style>", at));
}

/** The opening tags whose attributes set `prop`, each with the text that follows
 *  it — enough to tell a leaf from an element with a subtree under it. The
 *  caller checks the count against the raw occurrences, so a tag this misses
 *  fails the case rather than passing it. */
function elementsSetting(code: string, prop: string): { tag: string; after: string }[] {
  return [...code.matchAll(/<[a-zA-Z][^<>]*>/g)]
    .filter((tag) => tag[0].includes(prop))
    .map((tag) => ({ tag: tag[0], after: code.slice(tag.index + tag[0].length).trimStart() }));
}

/** How many times `prop` is set anywhere in `code`. */
const timesSet = (code: string, prop: string): number => code.split(prop).length - 1;

/** Every declaration — `property: value` — in which `needle` appears. */
function declarationsUsing(code: string, needle: string): string[] {
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const at = code.indexOf(needle, from);
    if (at < 0) return found;
    from = at + needle.length;
    const starts = ["{", "}", ";"].map((c) => code.lastIndexOf(c, at));
    const ends = [";", "}"].map((c) => code.indexOf(c, at)).filter((i) => i > 0);
    found.push(code.slice(Math.max(...starts) + 1, Math.min(...ends)).trim());
  }
}

/** The declarations of the first rule whose selector mentions `selector`. */
function ruleFor(sheet: string, selector: string): string {
  const at = sheet.indexOf(selector);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return block(sheet, sheet.indexOf("{", at));
}

const REDUCED = "@media (prefers-reduced-motion: reduce)";

function reducedMotionBlock(sheet: string): string {
  const at = sheet.indexOf(REDUCED);
  if (at < 0) throw new Error("no reduced-motion block");
  return block(sheet, sheet.indexOf("{", at));
}

/**
 * Every class this stylesheet gives an `animation` declaration to, scraped
 * rather than restated: a fifth animated class added tomorrow has to be handled
 * by the reduced-motion block, and a list written out here by hand would not
 * know about it.
 */
function animatedClasses(sheet: string): string[] {
  const outside = sheet.slice(0, sheet.indexOf(REDUCED));
  const found = new Set<string>();
  for (const [, selector, body] of outside.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\banimation[-:]/.test(body)) continue;
    for (const cls of selector.matchAll(/\.([\w-]+)/g)) found.add(cls[1]);
  }
  return [...found].sort();
}

describe("no reading can reach a timing property", () => {
  test("the watts-to-duration map is gone from the app, not just from the rails", async () => {
    // `flowDuration` is the original scar: a duration derived from a reading.
    // A census, because a leftover call anywhere still remaps elapsed time.
    const files = [...new Glob("**/*.{svelte,ts}").scanSync(SRC.pathname)].sort();
    const sources = await Promise.all(files.map(async (f) => [f, await read(f)] as const));
    const offenders = sources
      .filter(([f]) => f !== "lib/components/inverter/power-flow-pulse-wiring.test.ts")
      .filter(([, code]) => code.includes("flowDuration"))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  test("a rail's duration is the design's constant, spelled out", () => {
    // Derived from the token rather than restated: PULSE_SPAN / PULSE_SPEED is
    // where the number is decided, and every duration in the file has to be it.
    const durations = [...css(rails).matchAll(/animation-duration:\s*([^;]+);/g)].map((m) =>
      m[1].trim(),
    );
    expect(durations).not.toEqual([]);
    for (const d of durations) expect(d).toBe(`${PULSE_PERIOD_S}s`);
  });

  test("the phase offsets are a function of the layer index alone", () => {
    // `animation-delay` is the other timing property. It exists only inside
    // `layerStyle(i)`, whose only input is the index — so no reading can shift
    // a rail's phase, however the components are edited.
    expect(rails).not.toContain("animation-delay");
    expect(diagram).not.toContain("animation-delay");
    const body = block(signal, signal.indexOf("{", signal.indexOf("function layerStyle(")));
    const inside = body.split("animation-delay").length - 1;
    const everywhere = signal.split("animation-delay").length - 1;
    expect(inside).toBe(1);
    expect(everywhere).toBe(inside);
  });

  test("and the rail line no longer carries one at all", () => {
    const type = block(rails, rails.indexOf("{", rails.indexOf("export type RailLine")));
    expect(type).toContain("pulse: RailPulse");
    expect(type).not.toContain("dur");
  });
});

describe("the bloom is paint, not a filter", () => {
  test("no filter survives in the rails", () => {
    // `filter: drop-shadow()` re-rasters each path's whole bbox every frame on
    // a fanless wall panel. The glow is a wider translucent stroke instead.
    expect(css(rails)).not.toMatch(/\bfilter\s*:/);
    expect(rails).not.toContain("drop-shadow");
  });

  test("the wide stroke is the one under the comet", () => {
    const sheet = css(rails);
    expect(sheet).toMatch(/\.bloom\s*\{[^}]*stroke-width:\s*calc\(var\(--pulse-w\)/);
    expect(sheet).toMatch(/\.core\s*\{[^}]*stroke-width:\s*var\(--pulse-w\)/);
  });
});

describe("density changes without moving a comet", () => {
  test("the dash period is a per-layer constant and only the head grows", () => {
    // The head length is the only part of the dash pattern a reading reaches.
    // A changing PERIOD respaces every comet on the rail — the teleport this
    // whole design exists to avoid — so the period comes from `--lvl-period`,
    // which `layerStyle(i)` sets from the layer index.
    const dash =
      /stroke-dasharray:\s*var\(--pulse-dot\)\s+calc\(var\(--lvl-period\)\s*-\s*var\(--pulse-dot\)\)/;
    expect(css(rails)).toMatch(dash);
  });

  test("each layer is styled by its index and nothing else", () => {
    expect(argumentsOf(rails, "layerStyle")).toEqual(["i"]);
  });

  test("the intensity properties glide between samples", () => {
    // Registered so they can be transitioned at all: an unregistered custom
    // property is a token stream and jumps. All three are consumed by a rule
    // below, otherwise the transition is dead code and the bloom steps at 1 Hz.
    const sheet = css(rails);
    for (const prop of ["--pulse-dot", "--pulse-w", "--pulse-glow"]) {
      expect(sheet).toMatch(new RegExp(`@property ${prop}\\s*\\{`));
      expect(sheet).toMatch(new RegExp(`var\\(${prop}\\)`));
      expect(sheet).toMatch(new RegExp(`${prop} 700ms`));
    }
  });
});

describe("the diagram measures each rail against the remembered plant", () => {
  test("the ceiling is fed the plant's inbound throughput on the live edge", () => {
    // `inverter.latest` is a fresh object per sample (store.svelte.ts:30), so
    // reading it is what makes this effect run at the feed's cadence rather
    // than only when the graph's shape changes.
    const effects = [...diagram.matchAll(/\$effect\(/g)]
      .map((m) => callAt(diagram, m.index + "$effect".length))
      .filter((body) => body.includes("plantCeiling.observe("));
    expect(effects).toHaveLength(1);
    expect(effects[0]).toContain("inverter.latest");
    expect(argumentsOf(effects[0], "plantCeiling.observe")).toEqual([
      "throughputWatts(graph.segments)",
    ]);
  });

  test("a rail's pulse is measured against that ceiling, not against its neighbours", () => {
    const [watts, ceiling] = argumentsOf(diagram, "railPulse");
    expect(watts).toBe("s.value");
    // Max-of-current-segments normalisation pins the busiest cable at 1.0
    // forever; the reference has to be the remembered plant.
    expect(declaration(diagram, ceiling)).toContain("plantCeiling.watts");
  });

  test("and the pulse the rails receive is the one railPulse returned", () => {
    // Recomputing it in the literal — or handing on a neighbouring object — is
    // a one-token slip that leaves every other case here green.
    const computed = /const\s+(\w+)\s*=\s*railPulse\(/.exec(diagram)?.[1] ?? "";
    expect(computed).not.toBe("");
    const line = declaration(diagram, "lines");
    const literal = block(line, line.indexOf("{", line.lastIndexOf("return {")));
    expect(objectProperty(literal, "pulse")).toBe(computed);
  });
});

describe("a reversal fades instead of mirroring", () => {
  test("the each-key changes when the flow does", () => {
    // Keyed on the id alone, a rail that reverses keeps its group and its
    // running animation, and every comet on it teleports to the mirrored
    // phase. Keyed on the flow too, the group is replaced and fades.
    const key = /\{#each flowing as l \(([^)]*)\)\}/.exec(rails)?.[1] ?? "";
    expect(key).toContain("l.id");
    expect(key).toContain("l.flow");
  });

  test("the replacement crosses over, and holds still under reduced motion", () => {
    // A Svelte transition cannot be gated in CSS, so this is the one JS reader
    // of the media query in the file.
    expect(rails).toContain("transition:fade={{ duration: fadeMs }}");
    const query = /const\s+(\w+)\s*=\s*new MediaQuery\(/.exec(rails)?.[1] ?? "";
    expect(query).not.toBe("");
    expect(rails).toContain("prefers-reduced-motion: reduce");
    expect(declaration(rails, "fadeMs")).toMatch(new RegExp(`${query}\\.current \\? 0 :`));
  });
});

describe("reduced motion stops everything these files start", () => {
  test.each([
    [RAILS, () => rails],
    [DIAGRAM, () => diagram],
  ])("%s parks every class it animates", (_file, code) => {
    const sheet = css(code());
    const animated = animatedClasses(sheet);
    expect(animated).not.toEqual([]);
    const parked = reducedMotionBlock(sheet);
    for (const cls of animated) expect(parked).toContain(`.${cls}`);
    expect(parked).toContain("animation: none");
  });

  test("the wash and the ring hold their idle look under reduced motion", () => {
    // The wash's 900 ms opacity glide is motion too, however slow.
    const parked = reducedMotionBlock(css(diagram));
    expect(parked).toContain("transition: none");
  });

  test("the rails park their beads at the layer's own phase", () => {
    // Stopped mid-cycle every layer would sit at offset 0 and the comets would
    // pile up on top of each other; parked at `--lvl-phase` they stay the
    // evenly interleaved beads whose count still encodes the power.
    const parked = reducedMotionBlock(css(rails));
    expect(parked).toMatch(/stroke-dashoffset:\s*calc\(var\(--lvl-phase\)\s*\*\s*-1\)/);
    expect(parked).toContain("transition: none");
  });
});

describe("the hub, the wash and the nodes answer the plant's load", () => {
  test("the plant level is carried by leaves, never by an ancestor", () => {
    // On the diagram root it would re-resolve style for the whole node subtree,
    // AnimatedNumber included, ~90% of every second. `inherits: false` keeps it
    // off descendants; setting it only on childless elements keeps it off the
    // wrappers too, so the two claims cannot drift apart.
    const setters = elementsSetting(diagram, "--plant-level:");
    expect(setters).not.toEqual([]);
    // Every place the file sets it is one of the tags examined below.
    expect(setters).toHaveLength(timesSet(diagram, "--plant-level:"));
    for (const el of setters) expect(el.after.slice(0, 2)).toBe("</");
    expect(setters.filter((el) => /class=[^>]*hub-ring/.test(el.tag))).toHaveLength(1);
    expect(ruleFor(css(diagram), "@property --plant-level")).toContain("inherits: false");
  });

  test("only opacity and transform ever see it", () => {
    // A `color-mix` percentage inside the wash's `background` would repaint a
    // hero-sized radial gradient continuously instead of compositing a layer.
    const declarations = declarationsUsing(css(diagram), "var(--plant-level)");
    expect(declarations).not.toEqual([]);
    for (const d of declarations) {
      expect(["opacity", "transform"]).toContain(d.slice(0, d.indexOf(":")).trim());
      expect(d).not.toContain("color-mix");
      expect(d).not.toContain("background");
    }
  });

  test("the wash fades its own opacity, on a transition of its own", () => {
    const wash = ruleFor(css(diagram), ".wash");
    expect(wash).toMatch(/opacity:\s*calc\([^;]*var\(--plant-level\)/);
    expect(wash).toMatch(/transition:\s*opacity 900ms linear/);
  });

  test("the ring's beat is amplitude-modulated, so an idle plant barely ticks", () => {
    // Same period, smaller swing: the ring stops reading as full throttle at
    // 300 W without any timing property moving.
    const frames = ruleFor(css(diagram), "@keyframes hub-pulse");
    expect(frames).toMatch(/opacity:\s*calc\([^;]*var\(--plant-level\)/);
    expect(frames).toMatch(/scale\(calc\([^)]*var\(--plant-level\)/);
  });

  test("the level painted is a share of the same remembered plant as the rails", () => {
    // Captured from the style attribute that really paints it: a second, stale
    // identifier next to the right one is the slip this catches.
    const ring = elementsSetting(diagram, "--plant-level:").find((el) =>
      /hub-ring/.test(el.tag),
    )?.tag;
    const painted = /--plant-level:\$\{(\w+)\}/.exec(ring ?? "")?.[1] ?? "";
    expect(painted).not.toBe("");
    const [, ceiling] = argumentsOf(diagram, "railPulse");
    expect(declaration(diagram, painted)).toContain(
      `pulseShare(throughputWatts(graph.segments), ${ceiling})`,
    );
  });

  test("each node is measured against that same ceiling, by its own value", () => {
    const nodes = declaration(diagram, "renderNodes");
    const literal = block(nodes, nodes.indexOf("{", nodes.indexOf("({")));
    const [, ceiling] = argumentsOf(diagram, "railPulse");
    expect(objectProperty(literal, "share")).toBe(`pulseShare(n.value, ${ceiling})`);
  });

  test("the node glows through the pure mix, on the transition it already had", () => {
    // No new element and no new animation: the signal rides the box-shadow
    // transition that is already on the box, and the colour comes from the
    // token mix `flow-pulse.ts` tests, not from a second literal here.
    expect(argumentsOf(node, "nodeGlow")).toEqual(["node.accent", "share"]);
    const shadow = node.split("\n").filter((l) => l.includes("box-shadow:"));
    expect(shadow).toHaveLength(1);
    expect(shadow[0]).toContain("${nodeGlow(");
    // The colour is the pure mix's output, not a second literal written here.
    expect(shadow[0]).not.toContain("color-mix");
    expect(node).toContain("transition-[box-shadow");
    expect(node).not.toContain("@keyframes");
    expect(node).not.toContain("animation");
  });

  test("share is a prop of the node, not a value it invents", () => {
    const destructured = block(node, node.indexOf("{", node.indexOf("let {")));
    const props = topLevelParts(withoutComments(destructured).slice(1, -1)).map((p) =>
      p.split(/[=:]/)[0].trim(),
    );
    expect(props).toContain("share");
  });
});
