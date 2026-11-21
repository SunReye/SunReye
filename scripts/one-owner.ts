// A behaviour met on more than one screen lives in one component (ADR 21 "One behaviour, one
// component", #836): no file of the SPA outside its owner rebuilds a segmented control, tabs in
// another look, a haptic, a transition, a chart's entrance or its reading, a pick list, a card, its
// glass, a link, a motion value or a pulse that reduced motion does not stop. A gate step;
// `bun scripts/one-owner.ts` lists the copies.
//
// It reads source text, so it cannot see: a chart drawn by hand in `<svg>` or `<div>`s, which names
// no chart or canvas; a second chart in a file that already holds an entrance; a card or a motion
// value built from a variable or a class it does not know; a pointer read through a library's own
// handlers.

import { Glob } from "bun";
import { first, glass, handCard, literalMotion, unstopped } from "./one-owner-find.ts";

const SRC = "apps/web/src/";

export interface Copy {
  readonly rule: string;
  readonly line: number;
}

export interface Rule {
  readonly name: string;
  /** Where the first copy in a source starts, if it holds one. */
  readonly found: (source: string) => number | undefined;
  /** Paths under `lib/` that own the behaviour, as prefixes, each with why it does. */
  readonly owners: Readonly<Record<string, string>>;
}

const KIT = "The kit (ADR 11): each control carries its own look, motion and haptic.";
const GALLERY = "The gallery shows each shared piece as it is.";

export const RULES: readonly Rule[] = [
  {
    name: "toggle group outside the segmented control",
    found: first(/ui\/toggle-group/u),
    owners: {
      "components/ui/": KIT,
      "components/segmented.svelte": "The segmented control itself.",
      "gallery/": GALLERY,
      "shell/Bar.svelte": "Navigation, which is no choice of a few (ADR 21).",
      "builder/ColourRow.svelte": "Swatches: each is a figure, not a word (ADR 21).",
      "settings/ImportSources.svelte":
        "A choice that may be left empty means the default (ADR 21).",
      "scene/PerfOverlay.svelte": "A choice that may be left empty means the default (ADR 21).",
    },
  },
  {
    name: "tabs list not segmented",
    found: first(/<Tabs\.List\b(?![^>]*variant="segmented")[^>]*>/u),
    owners: { "components/ui/": KIT, "gallery/": GALLERY },
  },
  {
    name: "haptics outside a shared component",
    found: first(/from "(?:[^"]*\/)?haptics(?:\.[jt]s)?"/u),
    owners: {
      "components/ui/": KIT,
      "components/add-button.svelte": "The add press, a primary action's `light`.",
      "components/drawer-sheet.svelte": "A drawer's snap, `soft`.",
      "components/drill-in/drill-in.svelte": "A pick among a drill-in's groups, `selection`.",
      "components/drill-in/push.svelte.ts": "A level's slide landing, `soft`.",
      "components/load-failed.svelte": "The retry, a primary action's `light`.",
      "components/nav-link.svelte": "A screen chosen, `selection`.",
      "components/open-row.svelte": "A row that opens a level, `soft`.",
      "components/removable-chip.svelte": "A chip removed, `light`.",
      "components/sort-head.svelte": "A sort chosen, `selection`.",
      "components/value-editor/editor-body.svelte":
        "The editor opening, `nudge`, and its apply, `light`.",
      "components/value-editor/enum-list.svelte": "A value chosen, `selection`.",
      "components/value-editor/wheel.svelte": "A wheel crossing a step, `selection`.",
      "chart-reading/reader.svelte.ts": "A reading crossing a band, `selection` (ADR 21).",
      "range/RangePane.svelte": "A finger paging the range, `selection`.",
      "range/Stepper.svelte": "An arrow or a swipe stepping the range, `selection`.",
      "builder/gestures.ts": "The canvas's presses: a module laid, moved or refused.",
      "builder/handles/grabbing.ts": "A handle's turn crossing a snapped step, `selection`.",
      "builder/picking.svelte.ts":
        "Every pick in the builder, from the canvas or the inspector, `soft`.",
      "builder/InspectorSheet.svelte": "The inspector sheet's snap, `soft`.",
      "feedback.ts": "A toast and its haptic, always together.",
      "controls/apply.ts": "A write confirmed by read-back, `success`.",
      "settings/HapticsRow.svelte": "The haptics switch reads and sets the switch itself.",
      "shell/Rail.svelte": "The rail's pin, `soft` (ADR 21).",
      "setup/AddSheet.svelte": "A primary press, `light`.",
      "setup/SignIn.svelte": "A primary press, `light`.",
    },
  },
  {
    name: "haptics library outside the haptics module",
    found: first(/from "web-haptics"|\bnavigator\.vibrate\b/u),
    owners: { "haptics.ts": "The one haptics module (ADR 21): its switch and its presets." },
  },
  {
    name: "bits-ui choice outside the kit",
    found: first(/import\s*\{[^}]*\b(?:ToggleGroup|Tabs)\b[^}]*\}\s*from\s*"bits-ui"/u),
    owners: { "components/ui/": KIT },
  },
  {
    name: "card outside the kit card",
    found: handCard,
    owners: { "components/ui/": KIT, "gallery/": GALLERY },
  },
  {
    name: "motion value outside the motion tokens",
    found: literalMotion,
    owners: {
      "motion.ts": "The motion tokens' own values.",
      "motion/": "The motion modules.",
      "animate.ts": "Springs and tweens run on the tokens' values in script.",
      "components/ui/input-otp/input-otp-slot.svelte": "A text caret's blink, no motion.",
    },
  },
  {
    name: "transition outside the motion modules",
    found: first(/from "svelte\/transition"/u),
    owners: {
      "motion.ts": "The motion tokens' transitions.",
      "motion/": "The motion modules.",
      "shell/route-slide.ts": "The route's slide (ADR 21).",
      "detail/day-slide.ts": "A day sheet's slide.",
      "components/ui/": KIT,
    },
  },
  {
    name: "pointer reading outside the one pointer reading",
    found: first(
      /\bonpointer(?:down|move)\b|addEventListener\(\s*["'`]pointer(?:down|move)|\btooltipContext\b/u,
    ),
    owners: {
      "chart-reading/reader.svelte.ts": "The one pointer reading (ADR 21).",
      // Drags and wheels that read no chart.
      "builder/InspectorSheet.svelte": "The inspector sheet's drag.",
      "builder/drawing.svelte.ts": "The canvas's presses and drags.",
      "components/drill-in/push.svelte.ts": "The drill-in's edge-swipe back.",
      "components/value-editor/wheel.svelte": "The value editor's wheel.",
      "shell/Rail.svelte": "The rail's resize.",
      "range/pager-drag.ts": "The range card's page drag.",
    },
  },
  {
    name: "chart without the chart entrance",
    found: first(/<(?:Chart|BarChart|LineChart|AreaChart|canvas)\b/u, /<ChartEntrance\b/u),
    owners: {
      "components/ui/": KIT,
      "gallery/": GALLERY,
      "builder/SceneCanvas.svelte": "The 3D scene's canvas is no chart.",
      "dashboard/SceneStandIn.svelte": "The 3D scene's stand-in is no chart.",
    },
  },
  {
    name: "glass card outside the kit card",
    found: first(/GlassCard|glass-card\.svelte/u),
    owners: {},
  },
  {
    name: "glass surface outside the kit card",
    found: glass,
    owners: {
      "components/ui/": "The kit card draws it; the kit's overlays bring their own.",
      "gallery/": GALLERY,
      "shell/Rail.svelte": "A surface of the shell, not a card.",
      "shell/Bar.svelte": "A surface of the shell, not a card.",
      "components/drill-in/drill-in.svelte": "A drill-in's sticky header, not a card.",
      "setup/LayoutStep.svelte": "The setup's bar over the builder, not a card.",
      "components/responsive-sheet.svelte": "An overlay's glass of its own.",
      "components/drawer-sheet.svelte": "An overlay's glass of its own.",
      "components/value-editor/value-editor.svelte": "An overlay's glass of its own.",
      "detail/DetailSheet.svelte": "An overlay's glass of its own.",
    },
  },
  {
    name: "link outside the text link",
    found: first(/hover:underline|variant="link"/u),
    owners: {
      "components/ui/": KIT,
      "components/text-link.svelte": "The text link itself.",
      "gallery/": GALLERY,
    },
  },
  {
    name: "animation reduced motion does not stop",
    found: unstopped,
    owners: {},
  },
  {
    name: "pick list outside the select field",
    // A pick from a list in a form is a select field; a menu holds actions only. Source cannot
    // tell a form from a toolbar, so the menus that pick on the builder's canvas are named.
    found: first(/<(?:DropdownMenu|Menubar|ContextMenu)\.RadioGroup\b|ui\/radio-group/u),
    owners: {
      "components/ui/": KIT,
      "components/select-field.svelte": "The select field itself.",
      "gallery/": GALLERY,
      "builder/OpeningActions.svelte": "A canvas toolbar's menu, not a form.",
      "builder/WeatherMenu.svelte": "A canvas toolbar's menu, not a form.",
    },
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
    if (Object.keys(rule.owners).some((owner) => inLib.startsWith(owner))) return [];

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
