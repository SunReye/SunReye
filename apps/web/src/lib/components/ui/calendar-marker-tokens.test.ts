/**
 * The calendar's two day markers must resolve to different paint.
 *
 * A source-text test, with the limits that implies (`apps/web/TESTING.md`,
 * "Writing a source-text test"): the coverage that actually proves the bug gone
 * is `e2e/range-picker-selection.spec.ts`, which opens the picker in a browser
 * and reads `getComputedStyle`. This is the cheap canary beside it, and it is
 * NOT optional, for one reason: `calendar-day.svelte` and
 * `range-calendar-day.svelte` are VENDORED shadcn files. A future
 * `bun x shadcn-svelte@latest add calendar` regenerates them from upstream and
 * silently restores `bg-accent` on today — upstream is right to use it, because
 * upstream's `--accent` is a muted surface. Ours is not.
 *
 * THE INCIDENT. `src/app.css` sets `--accent` byte-identical to `--primary`, in
 * `:root` and again in `.dark`. The day components painted today with
 * `bg-accent` and range endpoints with `bg-primary`, so on /statistics a
 * one-day pick of Aug 16 painted Aug 16 and Aug 18 in the same solid blue with
 * the same white text: the window read as two days while the trigger correctly
 * said "Aug 16 – Aug 16". bits-ui was never confused — the phantom cell carries
 * no `data-selected` — so every attribute-level assertion stayed green.
 *
 * WHAT THIS FILE DOES NOT CLAIM. It does not assert `--accent !== --primary`.
 * Whether those two tokens are equal is a palette decision the designer owns,
 * `--accent` is spent as a hover/muted surface by roughly a dozen other
 * components, and a blanket assertion would fail for a legitimate choice while
 * still missing a calendar that painted today with, say, `bg-ring`. The claim
 * here is narrower and is about THIS component: whatever token the day paints
 * today with must not land on the same colour as the token it paints a selected
 * endpoint with. Both sides are read out of the component and resolved through
 * `app.css`, so a rename moves them together and a recolour is caught.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const UI_DIR = fileURLToPath(new URL(".", import.meta.url));
const APP_CSS = fileURLToPath(new URL("../../../app.css", import.meta.url));

/**
 * The day components, discovered from disk rather than listed.
 *
 * Both calendars carry the same collision, and a third calendar added later
 * (a month picker, a compact variant) inherits it the moment it is vendored in.
 * The exact-set assertion below is what makes "discovered" mean something: a new
 * `*-day.svelte` fails until someone adds it here on purpose.
 */
function dayComponents(): string[] {
  const found: string[] = [];
  for (const dir of readdirSync(UI_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.endsWith("calendar")) continue;
    for (const file of readdirSync(`${UI_DIR}${dir.name}`)) {
      if (file.endsWith("-day.svelte")) found.push(`${dir.name}/${file}`);
    }
  }
  return found.sort();
}

/** `--primary: oklch(…)` pairs inside one CSS rule, keyed without the dashes. */
function tokensIn(css: string, selector: string): Map<string, string> {
  // The block is bounded at its own closing brace at depth 0, so a nested
  // at-rule or a `{` inside a value cannot end it early.
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`app.css has no \`${selector}\` block`);
  let depth = 0;
  let end = start;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const block = css.slice(start, end);
  const tokens = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens.set(name, value.trim());
  }
  return tokens;
}

/**
 * Split a Tailwind utility into its variant chain and its base.
 *
 * At bracket depth 0 only: `[&[data-today]:not([data-selected])]:bg-accent` has
 * three colons and exactly one of them separates the variant from the utility.
 * Splitting on the last colon, or on the first, gets this class wrong — which is
 * the class the whole file is about.
 */
function splitUtility(utility: string): { variants: string; base: string } {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < utility.length; i++) {
    const char = utility[i];
    if (char === "[" || char === "(") depth++;
    else if (char === "]" || char === ")") depth--;
    else if (char === ":" && depth === 0) cut = i;
  }
  return cut < 0
    ? { variants: "", base: utility }
    : { variants: utility.slice(0, cut), base: utility.slice(cut + 1) };
}

/** Every utility in every string literal handed to the component's `cn(`. */
function utilitiesOf(source: string): { variants: string; base: string }[] {
  const call = source.indexOf("cn(");
  if (call < 0) throw new Error("component does not build its class with cn()");
  return [...source.slice(call).matchAll(/"([^"]*)"/g)]
    .flatMap(([, literal]) => literal.split(/\s+/))
    .filter((utility) => utility.length > 0)
    .map(splitUtility);
}

/** A variant chain that puts the rule on today's cell. */
const TARGETS_TODAY = /data-today/;
/**
 * A variant chain that puts the rule on a day the user picked — the range ends
 * for the range calendar, `data-selected` for the single-date one. `range-middle`
 * is deliberately absent: the band between two ends is a third role with its own
 * paint, not an endpoint.
 */
const TARGETS_SELECTED = /(range-start|range-end|data-\[selected|\[data-selected)/;
/** `not-data-selected:…` and `[&…:not([data-selected])]:…` select the opposite. */
const NEGATED_SELECTED = /not-data-selected|:not\(\[data-selected\]\)/;
/** Hover and focus are transient; the bug is what the cell paints at rest. */
const TRANSIENT = /hover|focus|active/;

type Role = "today" | "selected";

function utilitiesFor(
  role: Role,
  utilities: { variants: string; base: string }[],
  { dark }: { dark: boolean },
) {
  return utilities.filter(({ variants }) => {
    if (TRANSIENT.test(variants)) return false;
    if (/(^|:)dark(:|$)/.test(variants) !== dark) return false;
    if (role === "today") return TARGETS_TODAY.test(variants);
    return (
      !TARGETS_TODAY.test(variants) &&
      TARGETS_SELECTED.test(variants) &&
      !NEGATED_SELECTED.test(variants)
    );
  });
}

/**
 * The colour a `bg-…` utility lands on, resolved through `app.css`.
 *
 * `null` is "paints no background of its own" — a legitimate answer for an
 * outlined treatment, and one that can never equal a filled one. The opacity
 * suffix stays part of the identity: `bg-accent/50` is not `bg-accent`.
 */
function backgroundColour(
  utilities: { base: string }[],
  tokens: Map<string, string>,
): string | null {
  const painted = utilities.find(({ base }) => base.startsWith("bg-"));
  if (!painted) return null;
  const [token, alpha] = painted.base.slice("bg-".length).split("/");
  const value = tokens.get(token);
  if (!value) throw new Error(`app.css defines no --${token}, painted by bg-${painted.base}`);
  return alpha ? `${value} @${alpha}` : value;
}

/** Anything that would make today visible at all. */
const MARKS_TODAY = /^(bg|text|ring|inset-ring|border|outline|underline|font)-/;

const css = readFileSync(APP_CSS, "utf8");
const THEMES = [
  { name: "light", dark: false, tokens: tokensIn(css, ":root") },
  { name: "dark", dark: true, tokens: tokensIn(css, ".dark") },
] as const;

describe("calendar day markers", () => {
  const components = dayComponents();

  it("covers both vendored day components", () => {
    expect(components).toEqual([
      "calendar/calendar-day.svelte",
      "range-calendar/range-calendar-day.svelte",
    ]);
  });

  for (const component of components) {
    const utilities = utilitiesOf(readFileSync(`${UI_DIR}${component}`, "utf8"));

    it(`${component} marks today with something`, () => {
      const today = utilitiesFor("today", utilities, { dark: false });
      expect(today.filter(({ base }) => MARKS_TODAY.test(base)).length).toBeGreaterThan(0);
    });

    for (const theme of THEMES) {
      it(`${component} paints today and a picked day differently in ${theme.name}`, () => {
        // In `.dark` the day component overrides only what it names, so an
        // unqualified utility carries over from the light rules.
        const fallback = { dark: false } as const;
        const today =
          utilitiesFor("today", utilities, theme).length > 0
            ? utilitiesFor("today", utilities, theme)
            : utilitiesFor("today", utilities, fallback);
        const selected =
          utilitiesFor("selected", utilities, theme).length > 0
            ? utilitiesFor("selected", utilities, theme)
            : utilitiesFor("selected", utilities, fallback);

        const pickedBg = backgroundColour(selected, theme.tokens);
        // A selection nobody can see is the other way to make this pass.
        expect(pickedBg).not.toBeNull();
        expect(backgroundColour(today, theme.tokens)).not.toBe(pickedBg);
      });
    }
  }
});
