// A behaviour met on more than one screen lives in one component (ADR 21 "One behaviour, one
// component", #836): no file of the SPA outside its owner rebuilds a segmented control, tabs in
// another look, a haptic, a transition, a chart's entrance, a card's glass, a link or a pulse that
// reduced motion does not stop. A gate step; `bun scripts/one-owner.ts` lists the copies.

import { Glob } from "bun";

const SRC = "apps/web/src/";

export interface Copy {
  readonly rule: string;
  readonly line: number;
}

interface Rule {
  readonly name: string;
  /** Where the first copy in a source starts, if it holds one. */
  readonly found: (source: string) => number | undefined;
  /** Paths under `lib/` that own the behaviour, as prefixes. */
  readonly owners: readonly string[];
}

/** The first match of `pattern`, unless the file holds the shared piece itself (`composes`). */
const first =
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the patterns are only read.
  (pattern: RegExp, composes?: RegExp) =>
    (source: string): number | undefined =>
      composes?.test(source) === true ? undefined : pattern.exec(source)?.index;

/**
 * Every opening tag, whole: up to its first `>` outside a quoted value and outside an expression,
 * whose braces may nest three deep (an arrow function with an object in a call).
 */
const TAG =
  /<([A-Za-z][\w.:-]*)(?=[\s/>])(?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}|[^>"'{])*>/gu;

/** The source with its comments blanked, every offset kept. */
const uncommented = (source: string): string =>
  source.replaceAll(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|(?<![:"'`\w])\/\/.*$/gmu, (comment) =>
    comment.replaceAll(/[^\n]/gu, " "),
  );

/** The first `glass-ambient` that is not on the kit card's own tag. */
function bareGlass(commented: string): number | undefined {
  const source = uncommented(commented);

  /** Each kit card's opening tag, as its first and last offset. */
  const cards: (readonly [number, number])[] = [];

  for (const { 0: tag, 1: name, index } of source.matchAll(TAG))
    if (name === "Card.Root") cards.push([index, index + tag.length]);

  for (const { index } of source.matchAll(/glass-ambient/gu)) {
    if (!cards.some(([from, to]) => index > from && index < to)) return index;
  }

  return undefined;
}

/** The first pulse or spin whose own class string does not stop it under reduced motion. */
function unstopped(commented: string): number | undefined {
  const source = uncommented(commented);

  for (const { index } of source.matchAll(/(?<![\w:-])animate-(?:pulse|spin)(?![\w-])/gu)) {
    const open = Math.max(...['"', "'", "`"].map((quote) => source.lastIndexOf(quote, index)));

    const close = source.indexOf(source.charAt(open), index);

    if (!source.slice(open, close).includes("motion-reduce:animate-none")) return index;
  }

  return undefined;
}

// The haptics switch's own row, the rail's pin (ADR 21) and two primary presses. The list only shrinks.
const HAPTICS_HELD = [
  "settings/HapticsRow.svelte",
  "setup/AddSheet.svelte",
  "setup/SignIn.svelte",
  "shell/Rail.svelte",
];

const RULES: readonly Rule[] = [
  {
    name: "toggle group outside the segmented control",
    found: first(/ui\/toggle-group/u),
    owners: [
      "components/",
      "gallery/",
      // Navigation and swatches (ADR 21), and choices that may be left empty: none is segmented.
      "shell/Bar.svelte",
      "builder/ColourRow.svelte",
      "settings/ImportSources.svelte",
      "scene/PerfOverlay.svelte",
    ],
  },
  {
    name: "tabs list not segmented",
    found: first(/<Tabs\.List\b(?![^>]*variant="segmented")[^>]*>/u),
    owners: ["components/ui/", "gallery/"],
  },
  {
    name: "haptics outside a shared component",
    found: first(/from "(?:[^"]*\/)?haptics(?:\.[jt]s)?"/u),
    owners: [
      "components/",
      "range/",
      "builder/",
      "feedback.ts",
      "controls/apply.ts",
      ...HAPTICS_HELD,
    ],
  },
  {
    name: "transition outside the motion modules",
    found: first(/from "svelte\/transition"/u),
    owners: [
      "motion.ts",
      "motion/",
      "shell/route-slide.ts",
      "detail/day-slide.ts",
      "components/ui/",
    ],
  },
  {
    name: "chart without the chart entrance",
    found: first(/<(?:Chart|BarChart|LineChart|AreaChart|canvas)\b/u, /<ChartEntrance\b/u),
    // The 3D scene's canvases are no chart.
    owners: [
      "components/ui/",
      "gallery/",
      "builder/SceneCanvas.svelte",
      "dashboard/SceneStandIn.svelte",
    ],
  },
  {
    name: "glass card outside the kit card",
    found: first(/GlassCard|glass-card\.svelte/u),
    owners: [],
  },
  {
    name: "glass surface outside the kit card",
    found: bareGlass,
    owners: [
      "components/ui/",
      "gallery/",
      // Surfaces of the shell, not cards: the rail, the bottom bar, a drill-in's sticky header and
      // the setup's layout step's bar over the builder.
      "shell/Rail.svelte",
      "shell/Bar.svelte",
      "components/drill-in/drill-in.svelte",
      "setup/LayoutStep.svelte",
      // Overlays bring a glass of their own: the sheets and the value editor's popover.
      "components/responsive-sheet.svelte",
      "components/drawer-sheet.svelte",
      "components/value-editor/value-editor.svelte",
      "detail/DetailSheet.svelte",
    ],
  },
  {
    name: "link outside the text link",
    found: first(/hover:underline|variant="link"/u),
    owners: [
      "components/ui/",
      "components/text-link.svelte",
      "gallery/",
      // Held while the refused-read work of #836 changes it; it takes the text link next.
      "components/load-failed.svelte",
    ],
  },
  {
    name: "animation reduced motion does not stop",
    found: unstopped,
    owners: [],
  },
];

/** Whether the rules hold for this file: SPA source, not a test or a harness. */
function covered(path: string): boolean {
  return path.startsWith(SRC) && !/\.test\.ts$|\.harness\./u.test(path);
}

/** Every copy of an owned behaviour in one file. */
export function copies(path: string, source: string): Copy[] {
  if (!covered(path)) return [];

  // Owners are named from lib/; a route owns nothing.
  const lib = `${SRC}lib/`;
  const inLib = path.startsWith(lib) ? path.slice(lib.length) : "";

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a rule's patterns are only read.
  return RULES.flatMap((rule) => {
    if (rule.owners.some((owner) => inLib.startsWith(owner))) return [];

    const at = rule.found(source);

    return at === undefined
      ? []
      : [{ rule: rule.name, line: source.slice(0, at).split("\n").length }];
  });
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname;
  const paths = [...new Glob(`${SRC}**/*.{svelte,ts}`).scanSync(root)].toSorted();

  const sources = await Promise.all(paths.map((path) => Bun.file(`${root}${path}`).text()));

  const findings = paths.flatMap((path, index) =>
    copies(path, sources[index] ?? "").map((found) => `${path}:${found.line} ${found.rule}`),
  );

  for (const finding of findings) process.stderr.write(`${finding}\n`);

  if (findings.length > 0) {
    process.stderr.write(
      `\n${findings.length} copies of a shared behaviour: use its component (ADR 21, #836).\n`,
    );
    process.exitCode = 1;
  }
}
