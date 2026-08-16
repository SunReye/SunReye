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
import { crossingSeconds, railPulse } from "../../inverter/flow-pulse";

const SRC = new URL("../../../", import.meta.url);

const read = async (file: string): Promise<string> => await Bun.file(new URL(file, SRC)).text();

const RAILS = "lib/components/inverter/_shared/power-flow-rails.svelte";
const CHARGE = "lib/components/inverter/_shared/power-flow-charge.svelte";
const DIAGRAM = "lib/components/inverter/power-flow-diagram.svelte";
const NODE = "lib/components/inverter/power-flow-node.svelte";
const SIGNAL = "lib/inverter/flow-pulse.ts";

const rails = await read(RAILS);
const charge = await read(CHARGE);
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

/**
 * The `base` and `swing` of an amplitude-modulated value — `calc(base + swing *
 * var(--plant-level))`, the one shape this diagram is allowed to answer the
 * plant with. Split out because "a calc mentioning --plant-level" is true of
 * the inverted version too, and inverted is a diagram that flashes hardest at
 * midnight.
 */
function amplitude(text: string): { base: number; swing: number } {
  const m = /calc\(\s*([\d.]+)\s*([+-])\s*([\d.]+)\s*\*\s*var\(--plant-level\)\s*\)/.exec(text);
  if (!m) throw new Error(`not amplitude-modulated: ${text}`);
  return { base: Number(m[1]), swing: Number(m[3]) * (m[2] === "-" ? -1 : 1) };
}

/** Each frame of a `@keyframes` block, keyed by its whitespace-free selector. */
function frames(keyframes: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, selector, declarations] of keyframes.matchAll(/([\d%,\s]+)\{([^{}]*)\}/g))
    found.set(selector.replaceAll(/\s+/g, ""), declarations);
  return found;
}

/** The value a declaration block gives `property`. */
function valueOf(declarations: string, property: string): string {
  const m = new RegExp(`(?:^|[;{])\\s*${property}\\s*:([^;]*)`).exec(declarations);
  if (!m) throw new Error(`no ${property} in ${declarations}`);
  return m[1].trim();
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

  test("the one duration a reading reaches is the quantized crossing time", () => {
    // A charge per rail means speed IS the reading, so this design cannot claim
    // no reading reaches a timing property. What it claims instead: the only
    // timing a reading reaches is `pulse.dur`, and that value is quantized at
    // its source so an unchanged-enough sample never touches the animation.
    // The <animateMotion> takes its dur straight from the pulse and nowhere else.
    expect(timesSet(charge, "dur=")).toBe(1);
    expect(charge).toContain("dur={`${pulse.dur}s`}");
    expect(declaration(signal, "CROSS_STEP_S")).toBeTruthy();
    const body = block(signal, signal.indexOf("{", signal.indexOf("function crossingSeconds(")));
    expect(body).toContain("CROSS_STEP_S");
  });

  test("a step in that duration rebuilds the mover instead of remapping it", () => {
    // The whole reason the quantization is safe. SMIL remaps a running
    // animation when its dur changes, so the charge teleports to wherever the
    // new duration says it should be by now. Keyed on the duration, a step
    // replaces the element and the new speed starts from the top of the path.
    expect(charge).toMatch(/\{#key pulse\.dur\}/);
  });

  test("nothing else in these components animates on a datum", () => {
    // Everything except that one dur stays a constant of the design.
    // The rails are pure structure now — the charge owns the only stylesheet.
    expect(rails).not.toContain("<style>");
    expect(css(charge)).not.toContain("animation-duration");
    for (const code of [rails, charge, diagram]) expect(code).not.toContain("animation-delay");
  });

  test("a quantized duration really does absorb a 1 Hz wobble", () => {
    // The claim above, exercised rather than asserted about the source: two
    // neighbouring samples must produce the identical attribute value.
    expect(railPulse(4000, 9000).dur).toBe(railPulse(4030, 9000).dur);
    expect(crossingSeconds(0.5)).toBe(crossingSeconds(0.52));
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
  // The rails animate through SMIL, which no @media block can stop; their guard
  // is in the markup and has its own case below. This one covers the components
  // that animate in CSS.
  test.each([[DIAGRAM, () => diagram]])("%s parks every class it animates", (_file, code) => {
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

  test("the rails animate in SMIL, so they have no CSS animation to park", () => {
    // Stated rather than assumed: if a CSS animation is ever added to this file
    // it needs a reduced-motion rule, and the case above will not cover it.
    expect(animatedClasses(css(charge))).toEqual([]);
  });

  test("the rails render no mover at all under reduced motion", () => {
    // SMIL is not reachable from CSS: a `@media` block cannot stop an
    // <animateMotion>. So the guard has to be in the markup, and the still it
    // falls back to is a plain overlay carrying the magnitude — not a frozen
    // sprite, which reads as debris left on the wire.
    const query = /const\s+(\w+)\s*=\s*new MediaQuery\(/.exec(rails)?.[1] ?? "";
    const guard = new RegExp(`\\{#if ${query}\\.current\\}`);
    expect(rails).toMatch(guard);
    const still = rails.slice(rails.search(guard), rails.indexOf("{:else}", rails.search(guard)));
    expect(still).not.toContain("PowerFlowCharge");
    expect(still).toContain("stroke-width={l.pulse.width}");
    // …and the charge — the only thing that animates — is on the other branch.
    const moving = rails.slice(rails.indexOf("{:else}", rails.search(guard)));
    expect(moving).toContain("<PowerFlowCharge");
    expect(charge).toContain("animateMotion");
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
    expect(wash).toMatch(/transition:\s*opacity 900ms linear/);
    // Brighter with the plant, never invisible at rest and never over 1: an
    // inverted or overdriven wash is a `calc` mentioning the level too.
    const { base, swing } = amplitude(valueOf(wash, "opacity"));
    expect(swing).toBeGreaterThan(0);
    expect(base).toBeGreaterThan(0);
    expect(base + swing).toBeLessThanOrEqual(1);
  });

  test("the ring's beat is amplitude-modulated, so an idle plant barely ticks", () => {
    // Same period, smaller swing: the ring stops reading as full throttle at
    // 300 W without any timing property moving. The claim is about the SIZE of
    // the swing, so it is checked at both ends — at an idle plant the beat has
    // to vanish into the rest frame, and a flipped sign (a ring that flashes
    // hardest at midnight) leaves a `calc(… var(--plant-level))` in place.
    const beat = frames(ruleFor(css(diagram), "@keyframes hub-pulse"));
    const rest = beat.get("0%,100%");
    const peak = beat.get("50%");
    expect(rest).toBeDefined();
    expect(peak).toBeDefined();

    const opacity = amplitude(valueOf(peak!, "opacity"));
    expect(opacity.base).toBe(Number(valueOf(rest!, "opacity")));
    expect(opacity.swing).toBeGreaterThan(0);
    expect(opacity.base + opacity.swing).toBeLessThanOrEqual(1);

    const scale = (t: string): string => /scale\((.*)\)/.exec(t)?.[1] ?? "";
    const growth = amplitude(scale(valueOf(peak!, "transform")));
    expect(growth.base).toBe(Number(scale(valueOf(rest!, "transform"))));
    expect(growth.swing).toBeGreaterThan(0);
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
