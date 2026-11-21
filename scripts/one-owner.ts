// A behaviour met on more than one screen lives in one component (ADR 21 "One behaviour, one
// component", #836): no file of the SPA outside its owner rebuilds a segmented control, tabs in
// another look, a haptic, a transition, a chart's entrance or a pick list. A gate step;
// `bun scripts/one-owner.ts` lists the copies.

import { Glob } from "bun";

const SRC = "apps/web/src/";

export interface Copy {
  readonly rule: string;
  readonly line: number;
}

interface Rule {
  readonly name: string;
  readonly found: RegExp;
  /** Paths under `lib/` that own the behaviour, as prefixes. */
  readonly owners: readonly string[];
  /** The file holds the shared piece itself, so the match is no copy. */
  readonly composes?: RegExp;
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
    found: /ui\/toggle-group/u,
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
    found: /<Tabs\.List\b(?![^>]*variant="segmented")[^>]*>/u,
    owners: ["components/ui/", "gallery/"],
  },
  {
    name: "haptics outside a shared component",
    found: /from "(?:[^"]*\/)?haptics(?:\.[jt]s)?"/u,
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
    found: /from "svelte\/transition"/u,
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
    found: /<(?:Chart|BarChart|LineChart|AreaChart|canvas)\b/u,
    // The 3D scene's canvases are no chart.
    owners: [
      "components/ui/",
      "gallery/",
      "builder/SceneCanvas.svelte",
      "dashboard/SceneStandIn.svelte",
    ],
    composes: /<ChartEntrance\b/u,
  },
  {
    name: "pick list outside the select field",
    // A pick from a list in a form is a select field; a menu holds actions only. Source cannot
    // tell a form from a toolbar, so the menus that pick on the builder's canvas are named.
    found: /<(?:DropdownMenu|Menubar|ContextMenu)\.RadioGroup\b|ui\/radio-group/u,
    owners: [
      "components/",
      "gallery/",
      "builder/OpeningActions.svelte",
      "builder/WeatherMenu.svelte",
    ],
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

    if (rule.composes?.test(source) === true) return [];

    const match = rule.found.exec(source);

    return match
      ? [{ rule: rule.name, line: source.slice(0, match.index).split("\n").length }]
      : [];
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
